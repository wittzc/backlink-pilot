#!/usr/bin/env bash
# Pre-commit warning：本次 commit 暂存了代码改动但未更新 active SoT 时提示。
# warning-only，永不阻塞（永远 exit 0）。纯 staged 检测，不比 timestamp。
set -e
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
# active SoT 解析（与 context-status.sh 一致：agent-context 优先；context.md 须含 Now/Next）
CTX=""
if [[ -f "$ROOT/docs/agent-context.md" ]]; then
  CTX="$ROOT/docs/agent-context.md"
elif [[ -f "$ROOT/docs/context.md" ]]; then
  if grep -q '^## Now' "$ROOT/docs/context.md" && grep -q '^## Next' "$ROOT/docs/context.md"; then
    CTX="$ROOT/docs/context.md"
  fi
fi
[[ -z "$CTX" ]] && exit 0
CTX_REL=${CTX#"$ROOT"/}
STAGED_CODE=$(git -C "$ROOT" diff --cached --name-only -- ':!docs' ':!*.md' ':!.ctx-relay')
STAGED_CTX=$(git -C "$ROOT" diff --cached --name-only -- "$CTX_REL")
[[ -n "$STAGED_CTX" ]] && exit 0
if [[ -n "$STAGED_CODE" ]]; then
  cat >&2 <<EOF

⚠️  本次 commit 含代码改动，但未更新 $CTX_REL 的 Now/Next。
    若本次改动影响项目状态，建议取消 commit、更新 context 后重提；
    若仅临时改动可忽略（本提示不阻塞 commit）。

EOF
fi
exit 0
