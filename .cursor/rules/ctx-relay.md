<!-- ctx-relay:start -->
项目上下文同步：会话开始先读 docs/context.md（或 docs/agent-context.md）的 Now/Next/Refs 了解现状。
开始用户任务前跑 `bash .ctx-relay/bin/context-status.sh`：stale → 先 reconcile 更新 context；dirty → 先看 git status/diff。
commit 时：subject 写 what，body 必带一行 `Why: <为什么这么改>`，有被否方案再带 `Rejected: <方案>（<一句理由>）`（merge/revert/fixup 及 docs:/chore:/style: 豁免）。
接手需要某处改动的 why 时：先 git log / git blame 找关联 commit body；没写的读 diff 自行重建并标注「推断」，不卡住等人补。
（Cursor 的 sessionStart hook additional_context 有已知 bug，故读端走 rules，不依赖该 hook。）
<!-- ctx-relay:end -->
