#!/bin/sh
# Claude Code status line for Pixel HQ. Claude hands this script a JSON blob on stdin after every turn;
# it tells Herdr how full the context is (label claude.context, 0-100) so the desk's pile of papers grows, and prints a short status.
# Needs python3. Outside a Herdr terminal it only prints the status.
input=$(cat)
read -r pct model <<EOT
$(printf '%s' "$input" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    d = {}
m = (d.get("model") or {}).get("display_name") or ""
c = d.get("context_window") or {}
p = c.get("used_percentage")
if p is None:
    # older Claude Code: estimate from the last assistant message in the transcript
    try:
        last = None
        for line in open(d.get("transcript_path") or ""):
            try:
                u = (json.loads(line).get("message") or {}).get("usage")
            except Exception:
                u = None
            if u:
                last = u
        if last:
            used = last.get("input_tokens", 0) + last.get("cache_read_input_tokens", 0) + last.get("cache_creation_input_tokens", 0)
            size = 1000000 if "1m" in (d.get("model") or {}).get("id", "").lower() else 200000
            p = used * 100.0 / size
    except Exception:
        pass
print(int(p) if p is not None else "", m.replace(" ", "_"))
' 2>/dev/null)
EOT
model=$(printf '%s' "$model" | tr '_' ' ')
if [ -n "$pct" ] && [ -n "$HC_TERMINAL_ID" ] && command -v hc >/dev/null 2>&1; then
  hc label "$HC_TERMINAL_ID" "claude.context=$pct" "claude.model=$model" >/dev/null 2>&1 &
fi
if [ -n "$pct" ]; then printf '%s · %s%% context' "$model" "$pct"; else printf '%s' "$model"; fi
