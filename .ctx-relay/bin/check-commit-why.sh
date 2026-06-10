#!/usr/bin/env bash
# Commit-msg warning：commit body 缺 Why: 行时提示（warning-only，永不阻塞，永远 exit 0）。
# 用法（由 commit-msg hook 调用）：check-commit-why.sh <commit-msg-file>
# 豁免：merge / revert / fixup / squash，以及 docs: / chore: / style: 类 trivial commit。
set -e
MSG_FILE="${1:-}"
[[ -n "$MSG_FILE" && -f "$MSG_FILE" ]] || exit 0

# 去掉注释行（git 默认 commentChar '#'）后取 subject 与全文
MSG=$(grep -v '^#' "$MSG_FILE" || true)
SUBJECT=$(printf '%s\n' "$MSG" | head -1)
[[ -z "$SUBJECT" ]] && exit 0

case "$SUBJECT" in
  Merge\ *|Revert\ *|fixup!*|squash!*) exit 0 ;;
  docs:*|docs\(*|chore:*|chore\(*|style:*|style\(*) exit 0 ;;
esac

printf '%s\n' "$MSG" | grep -q '^Why:' && exit 0

cat >&2 <<'EOF'

⚠️  本次 commit body 没有 Why: 行。
    接手的 agent 只能从 diff 看到改了什么，看不到为什么改、否了什么方案。
    下次 commit 请在 body 写一行 Why:（有被否方案再加一行 Rejected:）。
    本提示不阻塞 commit。

EOF
exit 0
