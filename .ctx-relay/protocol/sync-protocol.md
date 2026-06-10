## 项目上下文同步协议（ctx-relay）

### 启动（读端）
会话开始先读 docs/context.md（或 docs/agent-context.md）的 Now/Next/Refs。
系统提示 stale → 先 reconcile 再做用户任务；提示 dirty → 先 git status/diff 留意。

### 接手时（读端·按需重建 why）
需要某处改动的 why 时：先 `git log` / `git blame` 找该处关联 commit 的 body（Why:/Rejected: 行）。
没写 why 的，读 diff + 前后 commit 自行重建一个假设性 why，产出中标注「推断」，不卡住等人补。

### Commit 时（写端·决策层，why-first）
commit subject 写 what，body 必带一行 `Why: <为什么这么改，一句话>`；
该改动若否决过别的方案，再带一行 `Rejected: <方案>（<一句理由>）`。
diff 只记赢家，why 和被否的输家只活在 commit body 里。
豁免：merge / revert / fixup / squash，以及 docs: / chore: / style: 类 trivial commit。

### Commit 时（写端·状态层，自动主路）
执行 git commit 且含实质代码改动时，同一轮内：
1. 读 active SoT（agent-context.md 优先，否则含 Now/Next 的 context.md）
2. ≤6 行更新 ## Now / ## Next
3. 有关键取舍则更新 Refs（≤1 行）
4. context 纳入本次 commit（或紧接一个 commit）

### 收尾 / handoff（写端·沉淀层，手动触发）
用户说「收尾」「handoff」或调用 /ctx-close 时：
1. 判断本工作单元是否有值得沉淀的 why（决策/取舍/踩坑）；纯机械改动则只更新 context，不产 notes
2. 值得 → 写/更新 docs/notes/<YYYY-MM-DD>-<描述>.md，4 字段：做了什么/为什么/取舍/下一步
3. 更新 context 的 Now/Next + Refs 指向该 notes
4. 一并 commit
