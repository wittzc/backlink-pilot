# 项目上下文 — Backlink Pilot

跨工具上下文单一真相源（Claude Code / Codex / Cursor / …）。
`## Now` 与 `## Next` 各保持 ≤3 行。完整 agent 指令见
[AGENT_GUIDE.md](AGENT_GUIDE.md)；更早的决策见 [adr/](adr/) 与 [plans/](plans/)。

## Now

- v2.2 已上线：verdict 自我修正层（`locked`/`unlock`，失败自动回写 `targets.yaml`）+ agent 无关化指令重构（`AGENT_GUIDE.md` 作为 SoT）。
- 当前产品 = `Happy Horse AI`（https://www.ai-happyhorse.org）。站池约 258 个目标，143 个 `auto:yes`（verdict 层已把一批锁成 no/manual/dead）；目前已提交 47 / 失败 119 / 手动 16。
- 未提交：`targets.yaml` 带着验证轮次产生的 verdict locks（尚未 commit）。

## Next

<!-- 待仲长确认 — 以下为草稿推断 -->
- 提交待处理的 `targets.yaml` verdict locks。
- 继续批量提交剩余的 `auto:yes` 目标，或处理 `locked` 池（跑 `node src/cli.js locked` 分流）。
