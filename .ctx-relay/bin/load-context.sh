#!/usr/bin/env bash
# SessionStart 注入：派生区（git 实时算，永不过期）+ 意图区（context.md，只装 git 推不出的）。
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

# ---- 派生区：branch / 远端同步 / 工作区 / 最近 commit（手写这些必腐烂，所以由这里实时算）----
DERIVED=""
if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  BRANCH=$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
  SYNC="无远端跟踪"
  UPSTREAM=$(git -C "$ROOT" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)
  if [[ -n "$UPSTREAM" ]]; then
    COUNTS=$(git -C "$ROOT" rev-list --left-right --count "HEAD...$UPSTREAM" 2>/dev/null || echo "0	0")
    AHEAD=$(printf '%s' "$COUNTS" | awk '{print $1}')
    BEHIND=$(printf '%s' "$COUNTS" | awk '{print $2}')
    if [[ "$AHEAD" == "0" && "$BEHIND" == "0" ]]; then SYNC="与 $UPSTREAM 同步"
    elif [[ "$BEHIND" == "0" ]]; then SYNC="领先 $UPSTREAM $AHEAD 个 commit"
    elif [[ "$AHEAD" == "0" ]]; then SYNC="落后 $UPSTREAM $BEHIND 个 commit"
    else SYNC="领先 $AHEAD / 落后 $BEHIND（$UPSTREAM，已分叉）"
    fi
  fi
  DIRTY_N=$(git -C "$ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  WORKTREE="干净"
  [[ "$DIRTY_N" != "0" ]] && WORKTREE="$DIRTY_N 个文件有未提交变更"
  RECENT=$(git -C "$ROOT" log -5 --format='  %h %s' 2>/dev/null || true)
  DERIVED="git 实时状态（自动派生，勿手抄进 context）:
- branch: ${BRANCH}（${SYNC}）
- 工作区: ${WORKTREE}
- 最近 commit:
${RECENT}

"
fi

STATUS=$(bash "$(dirname "$0")/context-status.sh")
BODY="${DERIVED}项目当前状态（启动自动加载）:
$(cat "$CTX")"
case "$STATUS" in
  stale) BODY="$BODY

⚠️ context 落后于代码。开始任务前先读最近 commit(git log -5)与 Refs，reconcile 更新 Now/Next/Refs，再继续。";;
  dirty) BODY="$BODY

ℹ️ 工作区有未提交代码变更。开始前先 git status / diff --stat 留意。";;
esac
jq -Rn --arg b "$BODY" '{additionalContext: $b}'
