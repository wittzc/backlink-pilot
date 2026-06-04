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
