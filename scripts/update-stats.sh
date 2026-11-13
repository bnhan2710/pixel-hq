#!/bin/sh
# Rewrites the traffic table at the bottom of README.md and README.vi.md (between the stats markers) with the
# last 14 days of repo clones and page views. Needs `gh` signed in as someone who can read the repo's traffic.
set -eu
repo="${GITHUB_REPOSITORY:-bnhan2710/pixel-hq}"
clones=$(gh api "repos/$repo/traffic/clones" --jq .count)
views=$(gh api "repos/$repo/traffic/views" --jq .count)
python3 -I - "$clones" "$views" <<'PY'
import re, sys
clones, views = sys.argv[1], sys.argv[2]
tables = {
    "README.md": f"| Last 14 days | Total |\n| --- | --- |\n| Repo clones | {clones} |\n| Page views | {views} |",
    "README.vi.md": f"| 14 ngày gần nhất | Tổng |\n| --- | --- |\n| Clone repo | {clones} |\n| Lượt xem trang | {views} |",
}
for path, table in tables.items():
    text = open(path, encoding="utf-8").read()
    new = re.sub(r"(<!-- stats:start -->\n).*?(\n<!-- stats:end -->)", lambda m: m.group(1) + table + m.group(2), text, flags=re.S)
    if new != text:
        open(path, "w", encoding="utf-8").write(new)
PY
