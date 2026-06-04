# Architecture Decision Records

Decisions with cross-plan reuse value, promoted out of [`../plans/`](../plans/)
so they have a stable, independently-searchable anchor. Each ADR states the
context, the decision, the alternatives rejected, and the consequences.

| ADR | Decision |
|-----|----------|
| [2026-04-27-分层适配器架构.md](2026-04-27-分层适配器架构.md) | Batch submission uses a layered architecture (triage → generic / recipe / provider / site-specific → batch), not an omnipotent generic adapter nor 180 hand-written adapters |
| [2026-04-27-硬墙一律fail-fast不绕过.md](2026-04-27-硬墙一律fail-fast不绕过.md) | Hard walls (CAPTCHA / login / paywall) fail-fast into manual-review with a reason; no bypass, no paid captcha-solving services |
