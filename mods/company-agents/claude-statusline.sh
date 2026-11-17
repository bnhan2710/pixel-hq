#!/bin/sh
# Agent status line for Pixel HQ (Claude Code, Antigravity, and other compatible agents).
# The agent hands this script a JSON blob on stdin after every turn or status change;
# it tells Herdr how full the context is (labels agent.context / claude.context, 0-100),
# how much of the quota window is left (agent.quota / claude.quota, 0-100) and effort level (agent.effort / claude.effort)
# so the desk can show HP/SP bars, and prints a short status.
# Also clears the labels when the agent stops reporting them, so a stale number never outlives its source.
# Needs python3. Outside a Herdr terminal it only prints the status.
input=$(cat)
fields=$(printf '%s' "$input" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    if not isinstance(d, dict):
        d = {}
except Exception:
    d = {}

def clean(v):
    if not isinstance(v, str):
        v = "" if v is None else str(v)
    out = []
    for ch in v:
        o = ord(ch)
        if o <= 31 or o == 127:
            continue
        out.append(ch)
    return "".join(out).replace("|", "·")

m = (d.get("model") if isinstance(d.get("model"), dict) else {}) or {}
model = clean(m.get("display_name") or m.get("id") or "")
c = (d.get("context_window") if isinstance(d.get("context_window"), dict) else {}) or {}
p = c.get("used_percentage")
if p is None:
    # older Claude Code: estimate from the last assistant message in the transcript
    try:
        last = None
        for line in open(clean(d.get("transcript_path") or "") or "/nonexistent"):
            try:
                u = (json.loads(line).get("message") or {}).get("usage")
            except Exception:
                u = None
            if u:
                last = u
        if last:
            used = last.get("input_tokens", 0) + last.get("cache_read_input_tokens", 0) + last.get("cache_creation_input_tokens", 0)
            size = 1000000 if "1m" in clean((d.get("model") or {}).get("id", "") if isinstance(d.get("model"), dict) else "").lower() else 200000
            p = used * 100.0 / size
    except Exception:
        pass
pct = str(max(0, min(100, int(round(p))))) if isinstance(p, (int, float)) else ""

# Quota: Claude Code rate_limits or Antigravity quota
q_pct = None
rl = d.get("rate_limits") if isinstance(d.get("rate_limits"), dict) else {}
five = rl.get("five_hour") if isinstance(rl.get("five_hour"), dict) else {}
if isinstance(five.get("used_percentage"), (int, float)) and 0 <= five["used_percentage"] <= 100:
    q_pct = int(round(100 - five["used_percentage"]))
elif isinstance(d.get("quota"), dict):
    q_dict = d["quota"]
    g5h = q_dict.get("gemini-5h") or q_dict.get("3p-5h")
    if isinstance(g5h, dict) and "remaining_fraction" in g5h and isinstance(g5h["remaining_fraction"], (int, float)):
        q_pct = int(round(g5h["remaining_fraction"] * 100))

quota = str(max(0, min(100, q_pct))) if q_pct is not None else ""

eff = d.get("effort") if isinstance(d.get("effort"), dict) else {}
effort = clean(eff.get("level") or m.get("effort") or "")
print(pct + "|" + model + "|" + quota + "|" + effort)
' 2>/dev/null)
pct=${fields%%\|*}; rest=${fields#*\|}; model=${rest%%\|*}; rest=${rest#*\|}; quota=${rest%%\|*}; effort=${rest#*\|}

if [ -n "$HC_TERMINAL_ID" ] && command -v hc >/dev/null 2>&1; then
  args=""
  if [ -n "$pct" ]; then
    args="agent.context=$pct agent.model=$model claude.context=$pct claude.model=$model"
  else
    args="agent.context= agent.model= claude.context= claude.model="
  fi
  if [ -n "$quota" ]; then
    args="$args agent.quota=$quota claude.quota=$quota"
  else
    args="$args agent.quota= claude.quota="
  fi
  if [ -n "$effort" ]; then
    args="$args agent.effort=$effort claude.effort=$effort"
  else
    args="$args agent.effort= claude.effort="
  fi
  hc label "$HC_TERMINAL_ID" $args >/dev/null 2>&1 &
fi
if [ -n "$pct" ]; then
  if [ -n "$quota" ]; then printf '%s · %s%% context · %s%% 5h left' "$model" "$pct" "$quota"; else printf '%s · %s%% context' "$model" "$pct"; fi
else printf '%s' "$model"
fi
