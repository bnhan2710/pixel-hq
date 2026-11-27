import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/draft-release.py"
SPEC = importlib.util.spec_from_file_location("draft_release", SCRIPT)
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)

REPO = "owner/pixel-hq"
TAG = "v1.8.8"
ENDPOINT = f"repos/{REPO}/releases"
ORIGINAL = f"""## What's Changed
* feat: snap desks by @alice in https://github.com/{REPO}/pull/42
* fix: align saved desks by @bob in https://github.com/{REPO}/pull/43

**Full Changelog**: https://github.com/{REPO}/compare/v1.8.7...{TAG}
"""
SECTIONS = [{
    "heading": "Desks stay lined up",
    "detail": "Drag a desk to the nearest free spot on the grid.",
    "pull_requests": [42, 43],
}]
PRS = [
    {"title": "feat: snap desks", "body": "Desks snap after a drag.", "user": {"login": "alice"}},
    {"title": "fix: align saved desks", "body": None, "user": {"login": "bob"}},
]


class DraftReleaseTests(unittest.TestCase):
    def test_grouped_notes_keep_original_contributor_links(self):
        with patch.object(release, "github", side_effect=PRS), patch.object(release, "summarize", return_value=SECTIONS):
            body = release.release_notes(ORIGINAL, REPO, "test-key")
        self.assertIn("### Desks stay lined up", body)
        self.assertIn(f"@alice ([#42](https://github.com/{REPO}/pull/42))", body)
        self.assertIn(f"@bob ([#43](https://github.com/{REPO}/pull/43))", body)
        self.assertIn("Full changelog", body)
        self.assertNotIn("feat:", body)

    def test_missing_key_quota_error_and_bad_references_use_original(self):
        with patch.object(release, "github") as github:
            self.assertEqual(release.release_notes(ORIGINAL, REPO, None), ORIGINAL)
            github.assert_not_called()
        for result in [HTTPError("", 429, "quota", {}, None), [{**SECTIONS[0], "pull_requests": [42, 99]}],
                       [{**SECTIONS[0], "pull_requests": [42]}]]:
            response = Mock(side_effect=result) if isinstance(result, Exception) else Mock(return_value=result)
            with patch.object(release, "github", side_effect=PRS), patch.object(release, "summarize", response):
                self.assertEqual(release.release_notes(ORIGINAL, REPO, "test-key"), ORIGINAL)

    def test_gemini_request_pins_requested_model(self):
        response = Mock()
        response.read.return_value = json.dumps({"candidates": [{
            "finishReason": "STOP",
            "content": {"parts": [{"text": "internal thought", "thought": True}, {"text": json.dumps({"sections": SECTIONS})}]},
        }]}).encode()
        with patch.object(release, "urlopen") as send:
            send.return_value.__enter__.return_value = response
            self.assertEqual(release.summarize("test-key", ORIGINAL, []), SECTIONS)
            request = send.call_args.args[0]
            self.assertTrue(request.full_url.endswith("/gemini-3.5-flash-lite:generateContent"))
            self.assertEqual(request.get_header("X-goog-api-key"), "test-key")
            self.assertNotIn(b"test-key", request.data)

    def test_create_draft_only_and_leave_existing_release_alone(self):
        generated = {"body": ORIGINAL, "name": "Pixel HQ v1.8.8"}
        with patch.object(release, "github", side_effect=[[], generated, [], {"html_url": "https://github.com/draft"}]) as api:
            release.draft_release(REPO, TAG, None)
            self.assertEqual(api.call_args.args, (ENDPOINT, {
                "tag_name": TAG, "name": generated["name"], "body": ORIGINAL, "draft": True,
            }))
        with patch.object(release, "github", return_value=[{"tag_name": TAG, "draft": True}]) as api:
            release.draft_release(REPO, TAG, "test-key")
            api.assert_called_once_with(f"{ENDPOINT}?per_page=100&page=1")
        with patch.object(release, "github", side_effect=[[], generated, [{"tag_name": TAG}]]) as api:
            release.draft_release(REPO, TAG, None)
            self.assertEqual(api.call_count, 3)
        with patch.object(release, "github", side_effect=[[], generated, {"private": True}, [], {"html_url": "draft"}]):
            with patch.object(release, "summarize") as summarize:
                release.draft_release(REPO, TAG, "test-key")
                summarize.assert_not_called()


if __name__ == "__main__":
    unittest.main()
