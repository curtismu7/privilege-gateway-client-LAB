#!/bin/sh
# Runs the shared UI-pattern checker (AI-DEMO-Standalone scripts/check-ui-patterns.mjs) on this lab, the way a reviewer does: the checker and
# shared/ come from the origin/main of a shared checkout (read only: git archive), and the lab is a copy of its tracked and new files under a
# throwaway standalone/ root. Nothing in the shared checkout is touched.
#
#   e2e/ui-patterns.sh [path-to-AI-DEMO-Standalone]      (default ~/Development/AI-DEMO-Standalone)
#
# Expect "2 pages: 2 clean" (ready, panel-dock) with one INFO line listing the three P9 escapes (see docs/fix-pass-step2.md).
set -e
LAB=$(cd "$(dirname "$0")/.." && pwd)
SHARED=${1:-$HOME/Development/AI-DEMO-Standalone}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/standalone/privilege-gateway-client-LAB"
(cd "$SHARED" && git archive origin/main scripts/check-ui-patterns.mjs scripts/ui-pattern-converted.txt shared) | tar -x -C "$TMP"
(cd "$LAB" && { git ls-files; git ls-files --others --exclude-standard; } | tar -cf - -T -) | tar -xf - -C "$TMP/standalone/privilege-gateway-client-LAB"
cd "$TMP" && node scripts/check-ui-patterns.mjs --root standalone --app privilege-gateway-client-LAB --verbose
