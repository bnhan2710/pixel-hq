#!/bin/sh
# Pixel HQ: give a `hermes --tui` terminal its desk at launch. The TUI's agent runs in a shared background host, so Hermes
# reports nothing until the first message. For each terminal address given: if it is live on this computer, has no status,
# and its foreground program is Hermes, write the `idle` status sequence to its tty (what Hermes' plugin writes itself later).
# Herdr clears the status when the shell gets the terminal back.
for T in "$@"; do
  P=$(hc get "$T" --json 2>/dev/null | python3 -c '
import json, sys
d = json.load(sys.stdin)
f = d.get("foreground") or {}
ok = d.get("state") == "live" and not d.get("status") and f.get("name") == "hermes"
print(d.get("pid") if ok else "")') || continue
  [ -n "$P" ] || continue
  Y=$(ps -o tty= -p "$P" | tr -d ' ')
  case "$Y" in ""|"?"|"??") continue ;; esac
  printf '\033]7501;state=idle:app=hermes\033\\' > "/dev/$Y" 2>/dev/null
done
exit 0
