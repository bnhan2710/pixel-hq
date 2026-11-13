#!/usr/bin/env python3
"""Builds stats.svg, the chart at the top of the README: growth of page views and clones (running totals), the star history, the totals since launch, stars and forks,
and where visitors come from. GitHub only keeps 14 days of traffic, so the days seen so far are kept in stats.json.
Needs `gh` signed in as someone who can read the repo's traffic (a token with "Administration: Read-only")."""
import json, os, subprocess, sys
from collections import OrderedDict
from datetime import date, datetime, timedelta, timezone
from html import escape

REPO = os.environ.get("GITHUB_REPOSITORY", "bnhan2710/pixel-hq")
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HISTORY, SVG = os.path.join(HERE, "stats.json"), os.path.join(HERE, "stats.svg")


def gh(path, *flags):
    return json.loads(subprocess.run(["gh", "api", *flags, f"repos/{REPO}{path}"], check=True, capture_output=True, text=True).stdout)


def star_days():
    """The day each star was given, oldest first (the star+json media type adds starred_at)."""
    out, page = [], 1
    while True:
        batch = gh(f"/stargazers?per_page=100&page={page}", "-H", "Accept: application/vnd.github.star+json")
        out += [b["starred_at"][:10] for b in batch if b.get("starred_at")]
        if len(batch) < 100:
            return sorted(out)
        page += 1


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

star_log = star_days()
total_clones = sum(v["clones"] for v in history.values())
total_views = sum(v["views"] for v in history.values())
first = min(history) if history else date.today().isoformat()

# --- growth chart: running totals per day, over the days since launch (at most 60) -----------------------------------------------------
today = datetime.now(timezone.utc).date()
n = max(4, min(60, (today - date.fromisoformat(first)).days + 2))
days = [(today - timedelta(days=n - 1 - i)).isoformat() for i in range(n)]
def running(key, day):
    return sum(v[key] for k, v in history.items() if k <= day)
series = [(d, running("views", d), running("clones", d)) for d in days]
peak = max([1] + [max(v, c) for _, v, c in series])
step = next(st for st in (10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000) if peak / st <= 5)
top_val = ((peak + step - 1) // step) * step

W, H = 900, 590
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

# growth chart (running totals)
cx0, cy0, cw, ch = 62, 196, 500, 150  # plot area
o += [f'<text x="24" y="186" font-size="11" fill="{TEXT}" letter-spacing="1" font-weight="700">GROWTH · TOTAL VIEWS AND CLONES OVER TIME</text>',
      f'<rect x="{cx0-30}" y="{cy0-8}" width="{cw+38}" height="{ch+56}" fill="{CARD}" stroke="{LINE}" stroke-width="2"/>']
for v in range(0, top_val + 1, step):
    y = cy0 + ch - ch * v / top_val
    o += [f'<line x1="{cx0}" x2="{cx0+cw}" y1="{y:.1f}" y2="{y:.1f}" stroke="{LINE}" stroke-width="1" opacity="0.5"/>',
          f'<text x="{cx0-8}" y="{y+4:.1f}" font-size="10" fill="{DIM}" text-anchor="end">{v}</text>']
px_of = lambda i: cx0 + 12 + i * (cw - 24) / (n - 1)
py_of = lambda val: cy0 + ch - ch * val / top_val
every = max(1, n // 7)
for i, (d, v, c) in enumerate(series):
    if (n - 1 - i) % every == 0:
        o.append(f'<text x="{px_of(i):.1f}" y="{cy0 + ch + 16}" font-size="10" fill="{DIM}" text-anchor="middle">{datetime.fromisoformat(d).strftime("%-d/%-m")}</text>')
o.append('<g shape-rendering="geometricPrecision">')
for idx, color in ((1, VIEWS), (2, CLONES)):
    pts = [(px_of(i), py_of(row[idx])) for i, row in enumerate(series)]
    line = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    base = cy0 + ch
    o.append(f'<polygon points="{pts[0][0]:.1f},{base} {line} {pts[-1][0]:.1f},{base}" fill="{color}" opacity="0.16"/>')
    o.append(f'<polyline points="{line}" fill="none" stroke="{color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>')
    for i, (x, y) in enumerate(pts):
        if i == 0 or series[i][idx] != series[i - 1][idx]:
            o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4" fill="{BG}" stroke="{color}" stroke-width="2"><title>{series[i][0]}: {series[i][idx]} total {"views" if idx == 1 else "clones"}</title></circle>')
o.append("</g>")
lx = px_of(n - 1)
vy, cy_ = py_of(series[-1][1]), py_of(series[-1][2])
o += [f'<text x="{lx-10:.1f}" y="{max(cy0+8, vy-10):.1f}" font-size="12" font-weight="700" fill="{VIEWS}" text-anchor="end">{series[-1][1]:,} views</text>',
      f'<text x="{lx-10:.1f}" y="{min(cy0+ch-6, cy_+(18 if abs(vy-cy_) < 22 else -10)):.1f}" font-size="12" font-weight="700" fill="{CLONES}" text-anchor="end">{series[-1][2]:,} clones</text>']
o += [f'<rect x="{cx0}" y="{cy0+ch+30}" width="9" height="9" fill="{VIEWS}"/><text x="{cx0+14}" y="{cy0+ch+38}" font-size="10" fill="{TEXT}">page views, running total</text>',
      f'<rect x="{cx0+190}" y="{cy0+ch+30}" width="9" height="9" fill="{CLONES}"/><text x="{cx0+204}" y="{cy0+ch+38}" font-size="10" fill="{TEXT}">clones, running total</text>']

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

# star history: the running count of stars, full width under the other charts
sy0 = 440  # top of the panel
o += [f'<text x="24" y="{sy0-10}" font-size="11" fill="{TEXT}" letter-spacing="1" font-weight="700">STAR HISTORY · {len(star_log)} PEOPLE STARRED PIXEL HQ</text>',
      f'<rect x="24" y="{sy0}" width="{W-48}" height="{H-sy0-24}" fill="{CARD}" stroke="{LINE}" stroke-width="2"/>']
s0 = date.fromisoformat(star_log[0]) - timedelta(days=1) if star_log else today - timedelta(days=3)
sn = max(4, min(120, (today - s0).days + 1))
sdays = [(today - timedelta(days=sn - 1 - i)).isoformat() for i in range(sn)]
spts = [(d, sum(1 for x in star_log if x <= d)) for d in sdays]
speak = max([1] + [c for _, c in spts])
sstep = next(st for st in (1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 5000) if speak * 1.3 / st <= 4)
stop = ((int(speak * 1.3) + sstep - 1) // sstep) * sstep  # headroom for the label above the last point
bx0, by0, bw_, bh = 62, sy0 + 16, W - 24 - 62 - 24, H - sy0 - 24 - 50
for v in range(0, stop + 1, sstep):
    y = by0 + bh - bh * v / stop
    o += [f'<line x1="{bx0}" x2="{bx0+bw_}" y1="{y:.1f}" y2="{y:.1f}" stroke="{LINE}" stroke-width="1" opacity="0.5"/>',
          f'<text x="{bx0-8}" y="{y+4:.1f}" font-size="10" fill="{DIM}" text-anchor="end">{v}</text>']
sx = lambda i: bx0 + 12 + i * (bw_ - 24) / (sn - 1)
sy = lambda val: by0 + bh - bh * val / stop
every_ = max(1, sn // 10)
for i, (d, c) in enumerate(spts):
    if (sn - 1 - i) % every_ == 0:
        o.append(f'<text x="{sx(i):.1f}" y="{by0 + bh + 16}" font-size="10" fill="{DIM}" text-anchor="middle">{datetime.fromisoformat(d).strftime("%-d/%-m")}</text>')
pts = [(sx(i), sy(c)) for i, (_, c) in enumerate(spts)]
line = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
o.append('<g shape-rendering="geometricPrecision">')
o.append(f'<polygon points="{pts[0][0]:.1f},{by0+bh} {line} {pts[-1][0]:.1f},{by0+bh}" fill="{YELLOW}" opacity="0.14"/>')
o.append(f'<polyline points="{line}" fill="none" stroke="{YELLOW}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>')
for i, (x, y) in enumerate(pts):
    if i == 0 or spts[i][1] != spts[i - 1][1]:
        o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4" fill="{BG}" stroke="{YELLOW}" stroke-width="2"><title>{spts[i][0]}: {spts[i][1]} stars</title></circle>')
o.append("</g>")
o.append(f'<text x="{pts[-1][0]-6:.1f}" y="{max(by0+2, pts[-1][1]-18):.1f}" font-size="12" font-weight="700" fill="{YELLOW}" text-anchor="end">{len(star_log)} stars</text>')
o.append("</svg>")
open(SVG, "w", encoding="utf-8").write("\n".join(o) + "\n")
print(f"stats.svg: {total_clones} clones, {total_views} views, {len(star_log)} stars, since {first}", file=sys.stderr)
