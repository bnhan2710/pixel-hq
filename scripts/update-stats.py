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


def gh(path, *flags, token=None):
    env = dict(os.environ, GH_TOKEN=token) if token else None
    r = subprocess.run(["gh", "api", *flags, f"repos/{REPO}{path}"], capture_output=True, text=True, env=env)
    if r.returncode:
        raise RuntimeError(f"gh api {path} failed: {(r.stderr or r.stdout).strip()[:300]}")
    return json.loads(r.stdout)


def star_days():
    """The day each star was given, oldest first (the star+json media type adds starred_at)."""
    out, page = [], 1
    while True:
        # the stars list is public: the workflow's own token reads it (the traffic token has no access to it)
        batch = gh(f"/stargazers?per_page=100&page={page}", "-H", "Accept: application/vnd.github.star+json", token=os.environ.get("GITHUB_TOKEN"))
        out += [b["starred_at"][:10] for b in batch if b.get("starred_at")]
        if len(batch) < 100:
            return sorted(out)
        page += 1


# --- data ---------------------------------------------------------------------------------------------------------------
clones, views, refs, repo = gh("/traffic/clones"), gh("/traffic/views"), gh("/traffic/popular/referrers"), gh("")
try:
    saved = json.load(open(HISTORY, encoding="utf-8"))
except (OSError, ValueError):
    saved = {}
# stats.json is {"days": {date: {clones, views}}, "stars": [date, ...]}; an older file was just the days
history = dict(saved["days"]) if "days" in saved else {k: v for k, v in saved.items() if k != "stars"}
for kind, data in (("clones", clones["clones"]), ("views", views["views"])):
    for d in data:
        day = d["timestamp"][:10]
        # days before the first visit are just zeros; they are only kept once something has happened
        if d["count"] or d["uniques"] or day in history or any(x["count"] for x in data if x["timestamp"][:10] < day):
            history.setdefault(day, {"clones": 0, "views": 0})[kind] = d["count"]
all_days = OrderedDict(sorted(history.items()))
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

try:
    star_log = star_days()
except RuntimeError as e:
    print(f"warning: {e}; using the star log from the last run", file=sys.stderr)
    star_log = saved.get("stars", [])
json.dump({"days": all_days, "stars": star_log}, open(HISTORY, "w", encoding="utf-8"), indent=1)
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
last_day = max(history) if history else days[0]  # GitHub publishes a day late: nothing is drawn after this
last_i = max([0] + [i for i, (d, _, _) in enumerate(series) if d <= last_day])
peak = max([1] + [max(v, c) for _, v, c in series])
step = next(st for st in (10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000) if peak / st <= 5)
top_val = ((peak + step - 1) // step) * step

W, H = 900, 300
BG, CARD, LINE, TEXT, DIM = "#11111b", "#181825", "#45475a", "#cdd6f4", "#7f849c"
VIEWS, CLONES, YELLOW, MAUVE = "#89b4fa", "#a6e3a1", "#f9e2af", "#cba6f7"
FONT = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"
o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="{FONT}" shape-rendering="crispEdges">',
     f'<title>Pixel HQ repo traffic: {total_views} page views and {total_clones} clones since launch</title>',
     f'<rect width="{W}" height="{H}" fill="{BG}"/>',
     f'<rect x="1" y="1" width="{W-2}" height="{H-2}" fill="none" stroke="{LINE}" stroke-width="2"/>',
     f'<text x="24" y="36" font-size="14" font-weight="700" fill="{VIEWS}" letter-spacing="1">REPO TRAFFIC · PIXEL HQ</text>',
     f'<text x="{W-24}" y="36" font-size="10" fill="{DIM}" text-anchor="end">since {datetime.fromisoformat(first).strftime("%b %-d, %Y")} · updated daily · GitHub lags about a day</text>']

# four number tiles
tiles = [("CLONES", "times the repo was cloned", total_clones, CLONES), ("VIEWS", "visits to this page", total_views, VIEWS),
         ("STARS", "people who starred it", repo["stargazers_count"], YELLOW), ("FORKS", "copies made to remix it", repo["forks_count"], MAUVE)]
tw = (W - 48 - 3 * 12) / 4
for i, (label, hint, value, color) in enumerate(tiles):
    x = 24 + i * (tw + 12)
    o += [f'<rect x="{x:.0f}" y="52" width="{tw:.0f}" height="60" fill="{CARD}" stroke="{LINE}" stroke-width="2"><title>{hint}</title></rect>',
          f'<rect x="{x:.0f}" y="52" width="4" height="60" fill="{color}"/>',
          f'<text x="{x+18:.0f}" y="74" font-size="10" fill="{DIM}" letter-spacing="1" font-weight="700">{label}</text>',
          f'<text x="{x+18:.0f}" y="100" font-size="26" font-weight="700" fill="{color}">{value:,}</text>']

PY, PH = 124, 152  # the three panels share a row
def panel(x, w, title):
    o.extend([f'<rect x="{x}" y="{PY}" width="{w}" height="{PH}" fill="{CARD}" stroke="{LINE}" stroke-width="2"/>',
              f'<text x="{x+12}" y="{PY+20}" font-size="10" fill="{TEXT}" letter-spacing="1" font-weight="700">{title}</text>'])
    return x + 34, PY + 34, w - 34 - 14, PH - 34 - 26  # plot x, y, w, h

def lines(x0, y0, w, h, days, rows, last, colors, fmt_nums=True):
    peak = max([1] + [max(r[1:]) for r in rows])
    st = next(s for s in (1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000) if peak * 1.05 / s <= 3)
    top = ((int(peak * 1.05) + st - 1) // st) * st
    nn = len(rows)
    for v in range(0, top + 1, st):
        y = y0 + h - h * v / top
        o.extend([f'<line x1="{x0}" x2="{x0+w}" y1="{y:.1f}" y2="{y:.1f}" stroke="{LINE}" stroke-width="1" opacity="0.5"/>',
              f'<text x="{x0-6}" y="{y+3:.1f}" font-size="9" fill="{DIM}" text-anchor="end">{v}</text>'])
    X = lambda i: x0 + 8 + i * (w - 16) / max(1, nn - 1)
    Y = lambda val: y0 + h - h * val / top
    ev = max(1, nn // 4)
    for i, r in enumerate(rows):
        if (nn - 1 - i) % ev == 0:
            o.append(f'<text x="{X(i):.1f}" y="{y0+h+14}" font-size="9" fill="{DIM}" text-anchor="middle">{datetime.fromisoformat(r[0]).strftime("%-d/%-m")}</text>')
    o.append('<g shape-rendering="geometricPrecision">')
    for idx, color in enumerate(colors, 1):
        pts = [(X(i), Y(r[idx])) for i, r in enumerate(rows[:last + 1])]
        ln = " ".join(f"{a:.1f},{b:.1f}" for a, b in pts)
        o.append(f'<polygon points="{pts[0][0]:.1f},{y0+h} {ln} {pts[-1][0]:.1f},{y0+h}" fill="{color}" opacity="0.15"/>')
        o.append(f'<polyline points="{ln}" fill="none" stroke="{color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>')
        for i, (a, b) in enumerate(pts):
            if i == 0 or i == last or rows[i][idx] != rows[i - 1][idx]:
                o.append(f'<circle cx="{a:.1f}" cy="{b:.1f}" r="3" fill="{BG}" stroke="{color}" stroke-width="2"><title>{rows[i][0]}: {rows[i][idx]}</title></circle>')
    o.append("</g>")
    return X(last), Y

# growth: running totals of views and clones
gx, gy, gw, gh_ = panel(24, 300, "GROWTH · VIEWS AND CLONES")
lx, Yg = lines(gx, gy, gw, gh_, None, series, last_i, (VIEWS, CLONES))
vy, cy_ = Yg(series[last_i][1]), Yg(series[last_i][2])
o += [f'<text x="{lx+8:.1f}" y="{vy+3:.1f}" font-size="10" font-weight="700" fill="{VIEWS}">{series[last_i][1]:,} views</text>',
      f'<text x="{lx+8:.1f}" y="{max(cy_+3, vy+15):.1f}" font-size="10" font-weight="700" fill="{CLONES}">{series[last_i][2]:,} clones</text>']

# star history
s0 = date.fromisoformat(star_log[0]) - timedelta(days=1) if star_log else today - timedelta(days=3)
sn = max(4, min(120, (today - s0).days + 1))
sdays = [(today - timedelta(days=sn - 1 - i)).isoformat() for i in range(sn)]
srows = [(d, sum(1 for x in star_log if x <= d)) for d in sdays]
sx0, sy0, sw, sh = panel(336, 300, f"STARS · {len(star_log)} PEOPLE")
slx, Ys = lines(sx0, sy0, sw, sh, None, srows, sn - 1, (YELLOW,))
o.append(f'<text x="{slx-8:.1f}" y="{max(sy0+8, Ys(srows[-1][1])-10):.1f}" font-size="10" font-weight="700" fill="{YELLOW}" text-anchor="end">{len(star_log)} stars</text>')

# where visitors come from
px, pw = 648, W - 24 - 648
panel(px, pw, "SOURCES · 14 DAYS")
most = max([1] + [c for _, c in top])
for i, (name, count) in enumerate(top[:4]):
    y = PY + 36 + i * 28
    o += [f'<text x="{px+12}" y="{y+9}" font-size="11" fill="{TEXT}">{escape(name)}</text>',
          f'<rect x="{px+12}" y="{y+14}" width="{max(3, (pw-24) * count / most):.0f}" height="5" fill="{YELLOW if i == 0 else VIEWS}"/>',
          f'<text x="{px+pw-12}" y="{y+9}" font-size="11" fill="{DIM}" text-anchor="end">{count}</text>']
if not top:
    o.append(f'<text x="{px+12}" y="{PY+56}" font-size="11" fill="{DIM}">no referrers yet</text>')
o.append("</svg>")
open(SVG, "w", encoding="utf-8").write("\n".join(o) + "\n")
print(f"stats.svg: {total_clones} clones, {total_views} views, {len(star_log)} stars, since {first}", file=sys.stderr)
