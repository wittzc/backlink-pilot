# Plans

Plan documents for backlink-pilot — design proposals, architecture evaluations,
and acceptance handoffs. New agents: read the relevant plan before touching the
subsystem it covers. Decision rationale with cross-plan reuse value is promoted
to [`../adr/`](../adr/).

| Plan | Topic |
|------|-------|
| [2026-04-26-backlink-pilot-优化方案.md](2026-04-26-backlink-pilot-优化方案.md) | Original v2.x optimization proposal (8 items) |
| [2026-04-26-backlink-pilot-优化方案-评审.md](2026-04-26-backlink-pilot-优化方案-评审.md) | CEO+Eng review that scoped the proposal down to M1+M2+M3.2 |
| [2026-04-27-批量外链提交优化方案.md](2026-04-27-批量外链提交优化方案.md) | First batch-submission design (superseded by the Recipe architecture below) |
| [2026-04-27-批量外链提交架构评估与Recipe方案.md](2026-04-27-批量外链提交架构评估与Recipe方案.md) | The governing batch architecture: triage buckets + layered adapters (generic / recipe / provider). Contains inline ADR-001…010 |
| [2026-04-27-Task0-5验收交接.md](2026-04-27-Task0-5验收交接.md) | Acceptance handoff for Tasks 0–5 |
| [2026-04-28-提交失败自我修正闭环.md](2026-04-28-提交失败自我修正闭环.md) | Verdict layer: failure code → write-back to targets.yaml, streak gate, field-level anti-regression |
| [2026-04-28-跨agent通用化协议.md](2026-04-28-跨agent通用化协议.md) | Agent-agnostic instructions: AGENT_GUIDE.md as SoT + tool-specific redirect stubs + agent-manifest.json |
| [2026-06-04-站点画像驱动的外链内容差异化方案.md](2026-06-04-站点画像驱动的外链内容差异化方案.md) | Per-site content personalization: `niche` field + agent-runtime copy generation (zero extra API) + `submit_text` fallback |
| [2026-06-12-comment-snowball立项与发现slice.md](2026-06-12-comment-snowball立项与发现slice.md) | 衍生新项目 comment-snowball(独立仓库)立项 + 发现 slice:Chrome 插件 + Google Sheet 流水线,滚雪球发现可发布博客文章库 → 导出喂 batch-blog-comments.js 闭环。含 Phase 0 假设验证(抓窗口期前的命脉侦察) |
| [2026-06-18-其余launch站推开交接.md](2026-06-18-其余launch站推开交接.md) | 交接给接手 AI:用 TinyLaunch 已验证的方法(登录态+原生 CDP+native setter+坑清单)逐站推开 overseas_launch_2026_06 里的免费 dofollow launch 站。含优先站清单、per-site protocol、判定基线、产品资产 |
