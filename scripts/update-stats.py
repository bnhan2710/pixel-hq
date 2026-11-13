#!/usr/bin/env python3
"""Builds stats.svg, the chart at the top of the README: daily page views and clones, the totals since launch, stars and forks,
and where visitors come from. GitHub only keeps 14 days of traffic, so the days seen so far are kept in stats.json.
Needs `gh` signed in as someone who can read the repo's traffic (a token with "Administration: Read-only")."""
import json, os, subprocess, sys
from collections import OrderedDict
from datetime import date, datetime, timedelta, timezone
from html import escape

REPO = os.environ.get("GITHUB_REPOSITORY", "bnhan2710/pixel-hq")
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HISTORY, SVG = os.path.join(HERE, "stats.json"), os.path.join(HERE, "stats.svg")


def gh(path):
    return json.loads(subprocess.run(["gh", "api", f"repos/{REPO}{path}"], check=True, capture_output=True, text=True).stdout)


# --- data ---------------------------------------------------------------------------------------------------------------
clones, views, refs, repo = gh("/traffic/clones"), gh("/traffic/views"), gh("/traffic/popular/referrers"), gh("")
try:
    history = json.load(open(HISTORY, encoding="utf-8"))
except (OSError, ValueError):
    history = {}
for kind, data in (("clones", clones["clones"]), ("views", views["views"])):
    for d in data:
        day = d["timestamp"][:10]
        # days before the first visit are just zeros; they are only kept once something has happened
        if d["count"] or d["uniques"] or day in history or any(x["count"] for x in data if x["timestamp"][:10] < day):
            history.setdefault(day, {"clones": 0, "views": 0})[kind] = d["count"]
json.dump(OrderedDict(sorted(history.items())), open(HISTORY, "w", encoding="utf-8"), indent=1)
history = {k: v for k, v in history.items() if v["clones"] or v["views"] or k > min(history)}

NAMES = [("herdr.dev", "Herdr gallery"), ("github.com", "GitHub"), ("zalo", "Zalo"), ("facebook.com", "Facebook"), ("fb.com", "Facebook"),
         ("google.", "Google"), ("t.co", "X (Twitter)"), ("twitter.com", "X (Twitter)"), ("x.com", "X (Twitter)"), ("reddit.com", "Reddit"),
         ("youtube.com", "YouTube"), ("linkedin.com", "LinkedIn"), ("news.ycombinator.com", "Hacker News"), ("discord", "Discord"),
         ("t.me", "Telegram"), ("telegram", "Telegram"), ("bing.com", "Bing"), ("duckduckgo.com", "DuckDuckGo")]
grouped = {}
for r in refs:
    name = next((n for k, n in NAMES if k in r["referrer"].lower()), r["referrer"])
    grouped[name] = grouped.get(name, 0) + r["count"]
top = sorted(grouped.items(), key=lambda kv: -kv[1])[:5]

total_clones = sum(v["clones"] for v in history.values())
total_views = sum(v["views"] for v in history.values())
first = min(history) if history else date.today().isoformat()

# --- chart: the last 7 to 30 days, oldest first ---------------------------------------------------------------------------
today = datetime.now(timezone.utc).date()
n = max(7, min(30, (today - date.fromisoformat(first)).days + 1))
days = [(today - timedelta(days=n - 1 - i)).isoformat() for i in range(n)]
series = [(d, history.get(d, {}).get("views", 0), history.get(d, {}).get("clones", 0)) for d in days]
peak = max([1] + [max(v, c) for _, v, c in series])
step = 1 if peak <= 5 else 2 if peak <= 10 else 5 if peak <= 25 else 10 if peak <= 60 else 25 if peak <= 150 else 50 if peak <= 300 else 100
top_val = ((peak + step - 1) // step) * step

W, H = 900, 424
BG, CARD, LINE, TEXT, DIM = "#11111b", "#181825", "#45475a", "#cdd6f4", "#7f849c"
VIEWS, CLONES, YELLOW, MAUVE = "#89b4fa", "#a6e3a1", "#f9e2af", "#cba6f7"
FONT = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"
o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="{FONT}" shape-rendering="crispEdges">',
     f'<title>Pixel HQ repo traffic: {total_views} page views and {total_clones} clones since launch</title>',
     f'<rect width="{W}" height="{H}" fill="{BG}"/>',
     f'<rect x="1" y="1" width="{W-2}" height="{H-2}" fill="none" stroke="{LINE}" stroke-width="2"/>',
     f'<text x="24" y="38" font-size="15" font-weight="700" fill="{VIEWS}" letter-spacing="1">REPO TRAFFIC · HOW MANY PEOPLE USE PIXEL HQ</text>',
     f'<text x="{W-24}" y="38" font-size="11" fill="{DIM}" text-anchor="end">since {datetime.fromisoformat(first).strftime("%b %-d, %Y")} · updated daily</text>']

# four number tiles
tiles = [("TOTAL CLONES", "times the repo was cloned", total_clones, CLONES), ("TOTAL VIEWS", "visits to this page", total_views, VIEWS),
         ("GITHUB STARS", "people who starred it", repo["stargazers_count"], YELLOW), ("FORKS", "copies made to remix it", repo["forks_count"], MAUVE)]
tw = (W - 48 - 3 * 12) / 4
for i, (label, hint, value, color) in enumerate(tiles):
    x = 24 + i * (tw + 12)
    o += [f'<rect x="{x:.0f}" y="56" width="{tw:.0f}" height="92" fill="{CARD}" stroke="{LINE}" stroke-width="2"/>',
          f'<rect x="{x:.0f}" y="56" width="4" height="92" fill="{color}"/>',
          f'<text x="{x+20:.0f}" y="82" font-size="11" fill="{TEXT}" letter-spacing="1" font-weight="700">{label}</text>',
          f'<text x="{x+20:.0f}" y="120" font-size="34" font-weight="700" fill="{color}">{value:,}</text>',
          f'<text x="{x+20:.0f}" y="138" font-size="10" fill="{DIM}">{hint}</text>']

# bar chart
cx0, cy0, cw, ch = 62, 196, 500, 150  # plot area
o += [f'<text x="24" y="186" font-size="11" fill="{TEXT}" letter-spacing="1" font-weight="700">VIEWS AND CLONES PER DAY</text>',
      f'<rect x="{cx0-30}" y="{cy0-8}" width="{cw+38}" height="{ch+56}" fill="{CARD}" stroke="{LINE}" stroke-width="2"/>']
for v in range(0, top_val + 1, step):
    y = cy0 + ch - ch * v / top_val
    o += [f'<line x1="{cx0}" x2="{cx0+cw}" y1="{y:.1f}" y2="{y:.1f}" stroke="{LINE}" stroke-width="1" opacity="0.5"/>',
          f'<text x="{cx0-8}" y="{y+4:.1f}" font-size="10" fill="{DIM}" text-anchor="end">{v}</text>']
slot = cw / n
bw = max(3, min(14, slot / 2 - 2))
for i, (d, v, c) in enumerate(series):
    x = cx0 + i * slot + (slot - 2 * bw - 2) / 2
    for j, (val, color) in enumerate(((v, VIEWS), (c, CLONES))):
        if val:
            h = max(2, ch * val / top_val)
            o.append(f'<rect x="{x + j * (bw + 2):.1f}" y="{cy0 + ch - h:.1f}" width="{bw:.1f}" height="{h:.1f}" fill="{color}"><title>{d}: {val} {"views" if j == 0 else "clones"}</title></rect>')
    if (n - 1 - i) % max(1, n // 7) == 0:
        o.append(f'<text x="{cx0 + i * slot + slot / 2:.1f}" y="{cy0 + ch + 16}" font-size="10" fill="{DIM}" text-anchor="middle">{datetime.fromisoformat(d).strftime("%-d/%-m")}</text>')
o += [f'<rect x="{cx0}" y="{cy0+ch+30}" width="9" height="9" fill="{VIEWS}"/><text x="{cx0+14}" y="{cy0+ch+38}" font-size="10" fill="{TEXT}">page views (visits)</text>',
      f'<rect x="{cx0+150}" y="{cy0+ch+30}" width="9" height="9" fill="{CLONES}"/><text x="{cx0+164}" y="{cy0+ch+38}" font-size="10" fill="{TEXT}">clones (downloads)</text>']

# where visitors come from
px, pw = 596, W - 24 - 596
o += [f'<text x="{px}" y="186" font-size="11" fill="{TEXT}" letter-spacing="1" font-weight="700">TRAFFIC SOURCES · 14 DAYS</text>',
      f'<rect x="{px}" y="{cy0-8}" width="{pw}" height="{ch+56}" fill="{CARD}" stroke="{LINE}" stroke-width="2"/>']
most = max([1] + [c for _, c in top])
for i, (name, count) in enumerate(top):
    y = cy0 + 14 + i * 29
    o += [f'<text x="{px+14}" y="{y+9}" font-size="12" fill="{TEXT}">{escape(name)}</text>',
          f'<rect x="{px+14}" y="{y+14}" width="{max(3, (pw-80) * count / most):.0f}" height="6" fill="{YELLOW if i == 0 else VIEWS}"/>',
          f'<text x="{px+pw-14}" y="{y+9}" font-size="12" fill="{DIM}" text-anchor="end">{count} views</text>']
if not top:
    o.append(f'<text x="{px+14}" y="{cy0+30}" font-size="12" fill="{DIM}">no referrers yet</text>')

o.append(f'<text x="{px+14}" y="{cy0+ch+38}" font-size="10" fill="{DIM}">where visitors came from, by platform</text>')
o.append("</svg>")
open(SVG, "w", encoding="utf-8").write("\n".join(o) + "\n")
print(f"stats.svg: {total_clones} clones, {total_views} views since {first}, {len(series)} days drawn", file=sys.stderr)
