---
name: ctx-close
description: 轻量收尾 — 把一个工作单元沉淀成 docs/notes/ 的 4 字段笔记，并更新 context.md 的 Now/Next/Refs。用户说「收尾」「handoff」或本工作单元结束时触发。
triggers:
  - "收尾"
  - "handoff"
  - "ctx-close"
---

# ctx-close

ctx-relay 的沉淀层收尾动作。把刚完成的工作单元的完整背景沉淀到文档，让冷启动的新 agent 不只看到 6 行状态，还能顺 Refs 读到「为什么这么做」。

**这是 plan-close 的轻量提炼**：只做沉淀，不含验收回填 / 通道分发 / ADR / 双链 / 父子同步 / verifier。

## 触发
用户说「收尾」「handoff」「ctx-close」，或一个工作单元完成时。

## 步骤
1. 判断本工作单元是否有值得沉淀的 why（关键决策 / 取舍 / 踩坑）。
   纯机械改动（typo、格式）→ 只更新 context.md 的 Now/Next，不产 notes，结束。
2. 值得沉淀 → 写或更新 `docs/notes/<YYYY-MM-DD>-<简短描述>.md`，固定 4 字段：
   - 做了什么：本工作单元的产出
   - 为什么：关键决策的理由
   - 取舍：放弃了什么 / 选 A 不选 B 的原因
   - 下一步：接续动作
3. 更新 active SoT（docs/agent-context.md 优先，否则 docs/context.md）的 ## Now / ## Next，并在 Refs 行指向刚写的 notes。
4. 一并 commit。

## 不做什么
- 不跑 verifier、不做通道分发、不建 ADR、不同步父子方案（那是重型 plan-close 的事）
- 不强制每次产 notes —— 没有值得记的 why 就跳过，只更新 context
