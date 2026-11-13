#!/bin/sh
# Rewrites the traffic table at the bottom of README.md and README.vi.md (between the stats markers) with the
# last 14 days of repo clones and page views. Needs `gh` signed in as someone who can read the repo's traffic.
set -eu
repo="${GITHUB_REPOSITORY:-bnhan2710/pixel-hq}"
clones=$(gh api "repos/$repo/traffic/clones" --jq .count)
views=$(gh api "repos/$repo/traffic/views" --jq .count)
refs=$(gh api "repos/$repo/traffic/popular/referrers")
python3 -I - "$clones" "$views" "$refs" <<'PY'
import json, re, sys
clones, views = sys.argv[1], sys.argv[2]
# Group referrer domains into the platform people know them by; anything unlisted keeps its domain name.
NAMES = [("herdr.dev", "Herdr gallery"), ("github.com", "GitHub"), ("zalo", "Zalo"), ("facebook.com", "Facebook"), ("fb.com", "Facebook"),
         ("google.", "Google"), ("t.co", "X (Twitter)"), ("twitter.com", "X (Twitter)"), ("x.com", "X (Twitter)"), ("reddit.com", "Reddit"),
         ("youtube.com", "YouTube"), ("linkedin.com", "LinkedIn"), ("news.ycombinator.com", "Hacker News"), ("discord", "Discord"),
         ("t.me", "Telegram"), ("telegram", "Telegram"), ("bing.com", "Bing"), ("duckduckgo.com", "DuckDuckGo")]
def platform(domain):
    d = domain.lower()
    return next((name for key, name in NAMES if key in d), domain)
from collections import OrderedDict
grouped = OrderedDict()
for r in sorted(json.loads(sys.argv[3]), key=lambda r: -r["count"]):
    g = grouped.setdefault(platform(r["referrer"]), [0, 0])
    g[0] += r["count"]; g[1] += r["uniques"]
top = sorted(grouped.items(), key=lambda kv: -kv[1][0])[:8]
rows = lambda: "".join(f"| {n} | {c} | {u} |\n" for n, (c, u) in top).rstrip("\n")
tables = {
    "README.md": f"| Last 14 days | Total |\n| --- | --- |\n| Repo clones | {clones} |\n| Page views | {views} |\n\n| Where visitors come from | Views | Visitors |\n| --- | --- | --- |\n" + rows(),
    "README.vi.md": f"| 14 ngày gần nhất | Tổng |\n| --- | --- |\n| Clone repo | {clones} |\n| Lượt xem trang | {views} |\n\n| Nguồn truy cập | Lượt xem | Người xem |\n| --- | --- | --- |\n" + rows(),
}
for path, table in tables.items():
    text = open(path, encoding="utf-8").read()
    new = re.sub(r"(<!-- stats:start -->\n).*?(\n<!-- stats:end -->)", lambda m: m.group(1) + table + m.group(2), text, flags=re.S)
    if new != text:
        open(path, "w", encoding="utf-8").write(new)
PY
