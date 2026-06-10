#!/usr/bin/env bash
# 校验 SoT 结构：含 ## Now + ## Next；Refs 行 ≤1。输出 pass / fail:<原因>。
set -uo pipefail
F="${1:?usage: validate-context.sh <file>}"
grep -q '^## Now' "$F" && grep -q '^## Next' "$F" || { echo "fail: missing Now/Next"; exit 1; }
REFS=$(grep -c '^Refs:' "$F" 2>/dev/null) || true
[[ "$REFS" -le 1 ]] || { echo "fail: >1 Refs line"; exit 1; }
echo pass
