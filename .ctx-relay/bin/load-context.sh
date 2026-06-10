#!/usr/bin/env bash
set -uo pipefail
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
CTX=""
if [[ -f "$ROOT/docs/agent-context.md" ]]; then
  CTX="$ROOT/docs/agent-context.md"
elif [[ -f "$ROOT/docs/context.md" ]] \
     && grep -q '^## Now' "$ROOT/docs/context.md" \
     && grep -q '^## Next' "$ROOT/docs/context.md"; then
  CTX="$ROOT/docs/context.md"
fi
[[ -z "$CTX" ]] && { echo '{"additionalContext":""}'; exit 0; }
STATUS=$(bash "$(dirname "$0")/context-status.sh")
BODY="项目当前状态（启动自动加载）:\n$(cat "$CTX")"
case "$STATUS" in
  stale) BODY="$BODY\n\n⚠️ context 落后于代码。开始任务前先读最近 commit(git log -5)与 Refs，reconcile 更新 Now/Next/Refs，再继续。";;
  dirty) BODY="$BODY\n\nℹ️ 工作区有未提交代码变更。开始前先 git status / diff --stat 留意。";;
esac
jq -Rn --arg b "$BODY" '{additionalContext: $b}'
