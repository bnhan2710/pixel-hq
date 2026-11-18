#!/bin/sh
# Pixel HQ: give every Hermes home (~/.hermes and each ~/.hermes/profiles/<name>) the status plugin in hermes-status/.
#
# Per home:
# - Not installed yet, and never installed before: copy it to plugins/pixel-hq-status and enable it with `hermes plugins enable`.
#   .pixel-hq-status-installed marks the home, so deleting the plugin later keeps it deleted.
# - Installed by Pixel HQ but older: copy the new files over. Never re-enables it.
# - For `hermes --tui` (the agent runs in a shared background host with no terminal): once, add HC_TERMINAL_ID to
#   terminal.client_env_passthrough, merged into what is there. .pixel-hq-status-tui marks it, so removing it by hand sticks.
#
# Usage: hermes-setup.sh <hermes-status folder>. Prints "<added> <updated> <failed> <tui>". Exits 3 when there is no Hermes home.
SRC="$1"
R="${HERMES_HOME:-$HOME/.hermes}"
[ -d "$R" ] || exit 3
V=$(grep -o "pixel-hq-hermes v[0-9]*" "$SRC/__init__.py" | head -1)
[ -n "$V" ] || exit 1
BIN=$(command -v hermes || true)
added=0 updated=0 failed=0 tui=0

merge() { # a passthrough list on stdin (JSON or YAML lines) -> the JSON list with HC_TERMINAL_ID, or "" if it is there
  python3 -c '
import json, sys
raw = sys.stdin.read().strip()
names = json.loads(raw) if raw.startswith("[") else [l.strip()[1:].strip() for l in raw.splitlines() if l.strip().startswith("-")]
names = [str(n) for n in names if str(n)]
print("" if "HC_TERMINAL_ID" in names else json.dumps(names + ["HC_TERMINAL_ID"]))'
}

for H in "$R" "$R"/profiles/*; do
  [ -f "$H/config.yaml" ] || continue
  T="$H/plugins/pixel-hq-status"
  if [ -d "$T" ]; then
    if grep -q "pixel-hq-hermes" "$T/__init__.py" 2>/dev/null \
      && [ "$(grep -o "pixel-hq-hermes v[0-9]*" "$T/__init__.py" | head -1)" != "$V" ]; then
      if cp "$SRC/__init__.py" "$SRC/plugin.yaml" "$T/"; then updated=$((updated + 1)); else failed=$((failed + 1)); fi
    fi
  elif [ ! -e "$H/.pixel-hq-status-installed" ] && [ -n "$BIN" ]; then
    if mkdir -p "$T" && cp "$SRC/__init__.py" "$SRC/plugin.yaml" "$T/" \
      && HERMES_HOME="$H" "$BIN" plugins enable pixel-hq-status --no-allow-tool-override </dev/null >/dev/null 2>&1; then
      : > "$H/.pixel-hq-status-installed"; added=$((added + 1))
    else
      rm -rf "$T"; failed=$((failed + 1))
    fi
  fi

  # The TUI hand-off, only where Pixel HQ's plugin is in place.
  grep -q "pixel-hq-hermes" "$T/__init__.py" 2>/dev/null || continue
  [ -e "$H/.pixel-hq-status-tui" ] && continue
  [ -n "$BIN" ] || continue
  cur=$(HERMES_HOME="$H" "$BIN" config get terminal.client_env_passthrough </dev/null 2>/dev/null) || continue
  new=$(printf '%s' "$cur" | merge) || continue
  if [ -z "$new" ]; then
    : > "$H/.pixel-hq-status-tui"
  elif HERMES_HOME="$H" "$BIN" config set terminal.client_env_passthrough "$new" </dev/null >/dev/null 2>&1; then
    : > "$H/.pixel-hq-status-tui"; tui=$((tui + 1))
  fi
done
echo "$added $updated $failed $tui"
