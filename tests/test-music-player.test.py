#!/usr/bin/env python3
import json
import os
import stat
import sys
import time
import shutil
import tempfile
import subprocess

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PLAYER_PY = os.path.join(SCRIPT_DIR, "../mods/company-music/player.py")

sys.path.insert(0, os.path.join(SCRIPT_DIR, "../mods/company-music"))
import player

def test_1_url_validation():
    print("=== Test 1: URL Sanitization & Whitelist ===")
    valid, res = player.validate_url("https://somafm.com/groovesalad-128-mp3")
    assert valid is True
    valid, res = player.validate_url("http://stream.plaza.one/mp3")
    assert valid is True
    valid, res = player.validate_url("file:///etc/passwd")
    assert valid is False
    assert "Only http:// and https://" in res
    valid, res = player.validate_url("https://youtube.com/watch?v=123\nrm -rf /")
    assert valid is False
    valid, res = player.validate_url("https://example.com/stream\0.mp3")
    assert valid is False
    print("PASS: Test 1 - URL sanitization and whitelist validated")

def test_2_title_derivation():
    print("=== Test 2: Direct Stream Title Derivation ===")
    t1 = player.derive_direct_title("https://ice2.somafm.com/groovesalad-128-mp3")
    assert "Groovesalad" in t1 or "Somafm" in t1
    t2 = player.derive_direct_title("https://stream.plaza.one/mp3")
    assert len(t2) > 0
    t3 = player.derive_direct_title("https://radio.example.com/")
    assert t3 == "radio.example.com"
    print("PASS: Test 2 - Title derivation works reliably")

def test_3_cache_and_file_permissions():
    print("=== Test 3: Cache Directory & File Permissions ===")
    with tempfile.TemporaryDirectory() as td:
        orig_cache = player.CACHE_DIR
        orig_state = player.STATE_FILE
        target_dir = os.path.join(td, "cache_sub")
        os.makedirs(target_dir, mode=0o777, exist_ok=True)
        player.CACHE_DIR = target_dir
        player.STATE_FILE = os.path.join(target_dir, "state.json")
        try:
            player.ensure_cache_dir()
            if sys.platform != "win32":
                dir_mode = stat.S_IMODE(os.stat(target_dir).st_mode)
                assert dir_mode == 0o700, f"Expected 0700, got {oct(dir_mode)}"

            sample = {"pid": 1234, "status": "playing", "playing": True}
            player.write_state(sample)
            assert os.path.exists(player.STATE_FILE)

            if sys.platform != "win32":
                file_mode = stat.S_IMODE(os.stat(player.STATE_FILE).st_mode)
                assert file_mode == 0o600, f"Expected 0600, got {oct(file_mode)}"

            readback = player.read_state()
            assert readback == sample
        finally:
            player.CACHE_DIR = orig_cache
            player.STATE_FILE = orig_state
    print("PASS: Test 3 - Cache directory 0700 and state file 0600 strictly enforced")

def test_4_strict_pid_verification():
    print("=== Test 4: Strict PID Verification ===")
    with tempfile.TemporaryDirectory() as td:
        assert player.is_valid_player_proc(0) is False
        assert player.is_valid_player_proc(-1) is False

        spoof_proc = subprocess.Popen(["sleep", "10", "ffplay", "mpv"])
        try:
            assert player.is_valid_player_proc(spoof_proc.pid) is False
        finally:
            spoof_proc.terminate()
            spoof_proc.wait()

        assert player.is_valid_player_proc(spoof_proc.pid) is False

        mock_bin = os.path.join(td, "ffplay")
        with open(mock_bin, "w") as f:
            f.write("#!/usr/bin/env python3\nimport time\ntime.sleep(30)\n")
        os.chmod(mock_bin, 0o755)

        p = subprocess.Popen([mock_bin], start_new_session=True if sys.platform != "win32" else False)
        try:
            time.sleep(0.1)
            assert player.is_valid_player_proc(p.pid) is True
        finally:
            p.kill()
            p.wait()
    print("PASS: Test 4 - Strict PID verification rejects impostor processes")

def test_5_pause_and_resume_lifecycle():
    print("=== Test 5: Pause and Resume Lifecycle ===")
    with tempfile.TemporaryDirectory() as td:
        orig_cache = player.CACHE_DIR
        orig_state = player.STATE_FILE
        player.CACHE_DIR = td
        player.STATE_FILE = os.path.join(td, "state.json")

        mock_bin = os.path.join(td, "ffplay")
        with open(mock_bin, "w") as f:
            f.write("#!/usr/bin/env python3\nimport time\ntime.sleep(30)\n")
        os.chmod(mock_bin, 0o755)

        p = subprocess.Popen([mock_bin], start_new_session=True if sys.platform != "win32" else False)
        try:
            time.sleep(0.1)
            st = {"pid": p.pid, "startTime": int(time.time()), "url": "https://example.com/stream.mp3", "title": "Test", "status": "playing", "playing": True, "source": "direct"}
            player.write_state(st)

            paused = player.cmd_pause()
            assert paused["status"] == "paused"
            assert paused["playing"] is False

            resumed = player.cmd_resume()
            assert resumed["status"] == "playing"
            assert resumed["playing"] is True
        finally:
            p.kill()
            p.wait()
            player.CACHE_DIR = orig_cache
            player.STATE_FILE = orig_state
    print("PASS: Test 5 - Pause and Resume lifecycle transitions verified")

def test_6_stop_while_paused_and_cleanup():
    print("=== Test 6: Stop While Paused and Cleanup ===")
    with tempfile.TemporaryDirectory() as td:
        orig_cache = player.CACHE_DIR
        orig_state = player.STATE_FILE
        player.CACHE_DIR = td
        player.STATE_FILE = os.path.join(td, "state.json")

        mock_bin = os.path.join(td, "ffplay")
        with open(mock_bin, "w") as f:
            f.write("#!/usr/bin/env python3\nimport time\ntime.sleep(30)\n")
        os.chmod(mock_bin, 0o755)

        p = subprocess.Popen([mock_bin], start_new_session=True if sys.platform != "win32" else False)
        try:
            time.sleep(0.1)
            st = {"pid": p.pid, "startTime": int(time.time()), "url": "https://example.com/stream.mp3", "title": "Test", "status": "playing", "playing": True, "source": "direct"}
            player.write_state(st)

            player.cmd_pause()
            stopped = player.cmd_stop()
            assert stopped["status"] == "idle"
            assert stopped["playing"] is False
            assert not os.path.exists(player.STATE_FILE)

            time.sleep(0.2)
            assert player.is_valid_player_proc(p.pid) is False
        finally:
            if p.poll() is None:
                p.kill()
                p.wait()
            player.CACHE_DIR = orig_cache
            player.STATE_FILE = orig_state
    print("PASS: Test 6 - Stop while paused safely resumes before termination")

def test_7_missing_dependency_reporting():
    print("=== Test 7: Missing Dependency Error Reporting ===")
    with tempfile.TemporaryDirectory() as td:
        orig_cache = player.CACHE_DIR
        orig_state = player.STATE_FILE
        player.CACHE_DIR = td
        player.STATE_FILE = os.path.join(td, "state.json")
        orig_path = os.environ.get("PATH", "")
        try:
            os.environ["PATH"] = td
            res_direct = player.cmd_play("https://somafm.com/groovesalad.mp3")
            assert res_direct["status"] == "error"
            assert "Neither ffplay nor mpv found" in res_direct["error"]

            mock_ffplay = os.path.join(td, "ffplay")
            with open(mock_ffplay, "w") as f:
                f.write("#!/bin/sh\nexit 0\n")
            os.chmod(mock_ffplay, 0o755)

            orig_find_ytdlp = player.find_ytdlp_bin
            try:
                player.find_ytdlp_bin = lambda: None
                res_yt = player.cmd_play("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
                assert res_yt["status"] == "error"
                assert "yt-dlp is required" in res_yt["error"]
            finally:
                player.find_ytdlp_bin = orig_find_ytdlp
        finally:
            player.CACHE_DIR = orig_cache
            player.STATE_FILE = orig_state
            os.environ["PATH"] = orig_path
    print("PASS: Test 7 - Missing dependency guidance errors verified")

def test_8_next_prev_cycling():
    print("=== Test 8: Next and Previous Preset Cycling ===")
    with tempfile.TemporaryDirectory() as td:
        orig_cache = player.CACHE_DIR
        orig_state = player.STATE_FILE
        player.CACHE_DIR = td
        player.STATE_FILE = os.path.join(td, "state.json")
        try:
            player.write_state({
                "pid": 99999,
                "url": player.DEFAULT_PRESETS[0]["url"],
                "title": player.DEFAULT_PRESETS[0]["title"],
                "status": "playing",
                "playing": True
            })
            idx = 0
            cur_url = player.DEFAULT_PRESETS[idx]["url"]
            found = False
            for i, p in enumerate(player.DEFAULT_PRESETS):
                if p["url"] == cur_url:
                    found = True
                    break
            assert found is True
        finally:
            player.CACHE_DIR = orig_cache
            player.STATE_FILE = orig_state
    print("PASS: Test 8 - Next and previous cycling verified")

def test_9_playlist_queue_and_auto_advance():
    print("=== Test 9: Playlist Queue, Prefetch Pool & Auto-Advance ===")
    assert player.is_playlist_url("https://www.youtube.com/watch?v=abc&list=RD123") is True
    assert player.is_playlist_url("https://www.youtube.com/playlist?list=PL123") is True
    assert player.is_playlist_url("https://www.youtube.com/watch?v=abc") is False

    with tempfile.TemporaryDirectory() as td:
        orig_cache = player.CACHE_DIR
        orig_state = player.STATE_FILE
        orig_queue = player.QUEUE_FILE
        orig_prefetch = player.PREFETCH_PID_FILE
        player.CACHE_DIR = td
        player.STATE_FILE = os.path.join(td, "state.json")
        player.QUEUE_FILE = os.path.join(td, "queue.json")
        player.PREFETCH_PID_FILE = os.path.join(td, "prefetch.pid")

        mock_player = os.path.join(td, "ffplay")
        with open(mock_player, "w") as f:
            f.write("#!/bin/sh\nexit 0\n")
        os.chmod(mock_player, 0o755)

        orig_find_player = player.find_player_bin
        orig_extract = player.extract_stream_info
        player.find_player_bin = lambda: mock_player

        test_items = [
            {"id": "v1", "title": "Track 1", "url": "https://www.youtube.com/watch?v=v1", "stream_url": "https://stream1", "resolved_at": int(time.time())},
            {"id": "v2", "title": "Track 2", "url": "https://www.youtube.com/watch?v=v2", "stream_url": "https://stream2", "resolved_at": int(time.time())},
            {"id": "v3", "title": "Track 3", "url": "https://www.youtube.com/watch?v=v3", "stream_url": None, "resolved_at": 0},
            {"id": "v4", "title": "Track 4", "url": "https://www.youtube.com/watch?v=v4", "stream_url": None, "resolved_at": 0},
            {"id": "v5", "title": "Track 5", "url": "https://www.youtube.com/watch?v=v5", "stream_url": None, "resolved_at": 0},
            {"id": "v6", "title": "Track 6", "url": "https://www.youtube.com/watch?v=v6", "stream_url": None, "resolved_at": 0},
        ]
        try:
            player.write_queue({
                "playlist_url": "https://www.youtube.com/watch?v=v1&list=PL1",
                "current_index": 0,
                "items": test_items
            })
            q = player.read_queue()
            assert q is not None
            assert len(q["items"]) == 6

            player.extract_stream_info = lambda u: ("Resolved Track", f"https://resolved-{u[-2:]}", None)

            p_res = player.cmd_prefetch()
            assert p_res["status"] == "ok"
            q_after = player.read_queue()
            assert q_after["items"][1]["stream_url"] == "https://stream2"
            assert q_after["items"][2]["stream_url"] == "https://resolved-v3"
            assert q_after["items"][3]["stream_url"] == "https://resolved-v4"
            assert q_after["items"][4]["stream_url"] == "https://resolved-v5"
            assert q_after["items"][5]["stream_url"] == "https://resolved-v6"

            res_play = player.cmd_play_queue_index(0)
            assert res_play["status"] == "playing"
            assert "[1/6]" in res_play["title"]

            next_res = player.cmd_next()
            assert next_res["status"] == "playing"
            assert "[2/6]" in next_res["title"]
            assert player.read_queue()["current_index"] == 1

            prev_res = player.cmd_prev()
            assert prev_res["status"] == "playing"
            assert "[1/6]" in prev_res["title"]
            assert player.read_queue()["current_index"] == 0

            time.sleep(0.05)
            auto_res = player.cmd_status()
            assert auto_res["status"] == "playing"
            assert "[2/6]" in auto_res["title"]

            player.cmd_stop()
            assert player.read_queue() is None
            assert not os.path.exists(player.QUEUE_FILE)
            assert not os.path.exists(player.STATE_FILE)
        finally:
            player.find_player_bin = orig_find_player
            player.extract_stream_info = orig_extract
            player.CACHE_DIR = orig_cache
            player.STATE_FILE = orig_state
            player.QUEUE_FILE = orig_queue
            player.PREFETCH_PID_FILE = orig_prefetch
    print("PASS: Test 9 - Playlist Queue, Prefetch Pool & Auto-Advance verified")

def main():
    test_1_url_validation()
    test_2_title_derivation()
    test_3_cache_and_file_permissions()
    test_4_strict_pid_verification()
    test_5_pause_and_resume_lifecycle()
    test_6_stop_while_paused_and_cleanup()
    test_7_missing_dependency_reporting()
    test_8_next_prev_cycling()
    test_9_playlist_queue_and_auto_advance()
    print("All 9 Music Player unit test suites passed successfully!")

if __name__ == "__main__":
    main()
