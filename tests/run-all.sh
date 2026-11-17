#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "=========================================="
echo "    Running Pixel HQ Agent Test Suite    "
echo "=========================================="

echo ""
node "$SCRIPT_DIR/test-opencode-tabs.test.js"
echo ""
bash "$SCRIPT_DIR/test-statusline.test.sh"
echo ""
node "$SCRIPT_DIR/test-vitals-labels.test.js"
echo ""
node "$SCRIPT_DIR/test-codex-vitals.test.js"
echo ""
echo "=========================================="
echo "    ALL TEST SUITES PASSED SUCCESSFULLY   "
echo "=========================================="
