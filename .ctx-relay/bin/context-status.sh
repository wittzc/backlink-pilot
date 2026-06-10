#!/usr/bin/env bash
# 输出 fresh / stale / dirty。优先级 stale > dirty > fresh。stale 用 commit graph。
set -uo pipefail
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo fresh; exit 0; }
CTX=""
if [[ -f "$ROOT/docs/agent-context.md" ]]; then
  CTX="docs/agent-context.md"
elif [[ -f "$ROOT/docs/context.md" ]] \
     && grep -q '^## Now' "$ROOT/docs/context.md" \
     && grep -q '^## Next' "$ROOT/docs/context.md"; then
  CTX="docs/context.md"
fi
[[ -z "$CTX" ]] && { echo fresh; exit 0; }
CODE_REV=$(git -C "$ROOT" rev-list -1 HEAD -- . ':!docs' ':!*.md' ':!.ctx-relay' 2>/dev/null)
CTX_REV=$(git -C "$ROOT" rev-list -1 HEAD -- "$CTX" 2>/dev/null)
if [[ -n "$CODE_REV" ]]; then
  if [[ -z "$CTX_REV" ]] || ! git -C "$ROOT" merge-base --is-ancestor "$CODE_REV" "$CTX_REV" 2>/dev/null; then
    echo stale; exit 0
  fi
fi
if [[ -n "$(git -C "$ROOT" status --porcelain -- ':!docs' ':!*.md' ':!.ctx-relay' 2>/dev/null)" ]]; then
  echo dirty; exit 0
fi
echo fresh
