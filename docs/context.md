# 项目上下文 — Backlink Pilot

跨工具上下文单一真相源（Claude Code / Codex / Cursor / …）。
`## Now` 与 `## Next` 各保持 ≤3 行。完整 agent 指令见
[AGENT_GUIDE.md](AGENT_GUIDE.md)；更早的决策见 [adr/](adr/) 与 [plans/](plans/)。

## Now

- niche 内容差异化能力已落地（v2.2 之上）：`targets.yaml` 加 `niche` 字段（81 个 auto:yes general 站已分类）、`submit --description-file` 接 agent 生成文案、AGENT_GUIDE 有 Niche-driven playbook。`npm test` 234 pass。方案见 [plans/2026-06-04-站点画像驱动的外链内容差异化方案.md](plans/2026-06-04-站点画像驱动的外链内容差异化方案.md)。
- 当前产品 = `Happy Horse AI`（https://www.ai-happyhorse.org）。站池 258，143 `auto:yes`。
- niche 功能 + 文档对齐已 push 到 `origin/main`（github.com/wittzc/backlink-pilot）。

## Next

- 真实试投验证：挑 3-5 个不同 niche 的站实跑一轮，对照基线看通过率（plan 的 rollback_trigger 看这个）。
- 验证有效后再做反馈闭环（Task 5：`submissions.yaml` 记 `niche` → 通过率）。
- 需要时 `git push` 同步 origin/main。
