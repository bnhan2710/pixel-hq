#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STATUSLINE="$REPO_DIR/mods/company-agents/claude-statusline.sh"

echo "=== Running statusline tests on $STATUSLINE ==="

# Mock hc binary to capture label calls
MOCK_BIN="$SCRIPT_DIR/mock_bin"
mkdir -p "$MOCK_BIN"
MOCK_LOG="$SCRIPT_DIR/mock_hc.log"
rm -f "$MOCK_LOG"

cat << 'EOF' > "$MOCK_BIN/hc"
#!/bin/sh
if [ "$1" = "label" ]; then
  shift
  echo "hc label $@" >> "$MOCK_HC_LOG"
fi
exit 0
EOF
chmod +x "$MOCK_BIN/hc"

export PATH="$MOCK_BIN:$PATH"
export HC_TERMINAL_ID="test_t99"
export MOCK_HC_LOG="$MOCK_LOG"

FAILURES=0

test_case() {
  local name="$1"
  local input="$2"
  local expected_out_regex="$3"
  local expected_label_regex="$4"

  rm -f "$MOCK_LOG"
  output=$(printf '%s' "$input" | "$STATUSLINE")

  if ! echo "$output" | grep -qE "$expected_out_regex"; then
    echo "FAIL: $name - Output mismatch"
    echo "  Expected regex: $expected_out_regex"
    echo "  Actual output:  $output"
    FAILURES=$((FAILURES + 1))
    return
  fi

  # Sleep briefly to ensure async background hc label command completed
  sleep 0.1

  local labels=""
  [ -f "$MOCK_LOG" ] && labels=$(cat "$MOCK_LOG")

  if [ -n "$expected_label_regex" ] && ! echo "$labels" | grep -qE "$expected_label_regex"; then
    echo "FAIL: $name - Label mismatch"
    echo "  Expected label regex: $expected_label_regex"
    echo "  Actual labels:        $labels"
    FAILURES=$((FAILURES + 1))
    return
  fi

  echo "PASS: $name"
}

# Test 1: Claude Code format
CLAUDE_JSON='{"model":{"id":"claude-3-7-sonnet","display_name":"Claude 3.7 Sonnet"},"context_window":{"used_percentage":42.4},"rate_limits":{"five_hour":{"used_percentage":25}},"effort":{"level":"high"}}'
test_case "Claude Code JSON" "$CLAUDE_JSON" \
  "Claude 3.7 Sonnet · 42% context · 75% 5h left" \
  "agent\.context=42.*agent\.model=Claude 3\.7 Sonnet.*agent\.quota=75"

# Test 2: Antigravity format (Gemini quota)
AGY_JSON='{"model":{"id":"Gemini 3.8 Flash (High)","display_name":"Gemini 3.8 Flash (High)"},"context_window":{"used_percentage":7.045},"quota":{"gemini-5h":{"remaining_fraction":0.959}}}'
test_case "Antigravity JSON (gemini-5h)" "$AGY_JSON" \
  "Gemini 3.8 Flash \(High\) · 7% context · 96% 5h left" \
  "agent\.context=7.*agent\.model=Gemini 3\.8 Flash \(High\).*agent\.quota=96"

# Test 3: Antigravity format (3p quota fallback)
AGY_3P_JSON='{"model":{"id":"Gemini 3.8 Pro","display_name":"Gemini 3.8 Pro"},"context_window":{"used_percentage":15.0},"quota":{"3p-5h":{"remaining_fraction":0.80}}}'
test_case "Antigravity JSON (3p-5h)" "$AGY_3P_JSON" \
  "Gemini 3.8 Pro · 15% context · 80% 5h left" \
  "agent\.context=15.*agent\.model=Gemini 3\.8 Pro.*agent\.quota=80"

# Test 4: Empty / malformed JSON
test_case "Empty JSON" "{}" \
  "^$" \
  ""

# Clean up
rm -rf "$MOCK_BIN" "$MOCK_LOG"

if [ "$FAILURES" -eq 0 ]; then
  echo "All statusline tests passed!"
  exit 0
else
  echo "$FAILURES statusline test(s) failed."
  exit 1
fi
