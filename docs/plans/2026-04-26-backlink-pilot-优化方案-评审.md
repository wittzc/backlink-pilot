# Backlink Pilot 优化方案评审备忘

> 评审日期：2026-04-26
> 评审对象：[2026-04-26-backlink-pilot-优化方案.md](2026-04-26-backlink-pilot-优化方案.md)（v1，未修订前）
> 评审 skill：`plan-ceo-review` + `plan-eng-review`
> 状态：已接受 → 触发原方案修订（见原方案 Delta Summary）

---

## CEO Review（产品方向）

### Problem We Think We're Solving
v2.1 在「兑现 README 承诺」「批量速度」「失败链路」上有缺口。

### What Might Be the Real Problem
1. 真痛点不是「代码缺批量命令」，而是 **agent-first 定位 vs 纯 CLI 用户的人群冲突**——README 卖的是 `claude` 路径，批量循环本应由 Claude 完成。加 `cli.js batch` 是发明平行系统。
2. 「bb.js 同步子进程」性能问题的实际严重度，**取决于一次会话提交多少站**。CLAUDE.md 自己规定 pacing「每会话 5-10 站」——单站多 30 秒几乎不可感。M4 投入 2-3 周可能在解一个不存在的问题。
3. README 数字不实是真问题，但更深的是 targets.yaml 缺自动化维护——dead 站清理只是治标。

### Existing Leverage
- Claude Code + CLAUDE.md 已是事实上的批量调度器
- bb-browser 反检测能力是核心护城河，重构有动到护城河的风险
- targets.yaml 的 YAML 格式是 agent-first 的表达，不该过度工程化

### Recommended Scope Mode：`SCOPE REDUCTION`

原方案 8 项里至少 3 项偏 over-engineering。HOLD SCOPE 会把 2-3 周投入到不会被使用的能力上。

**砍 / 改决策**：

| 原方案项 | 决策 | 理由 |
|---------|------|------|
| M3.1 `cli.js batch` 原生命令 | **降级**为 CLAUDE.md 新增「批量提交指引」一节 | 跟 agent-first 定位冲突，重复造轮子 |
| M3.3 `batch-submit.js` 重命名 | **删除** | 破坏性改动，收益极小 |
| M4 持久 session 改造 | **从 v2.x 周期移出**，进入 v3.0 候选池前先做性能测量 | 没有数据支撑改造决策 |
| M1 全部 | **保留** | ROI 极高 |
| M2 全部 | **保留 + 强化（next-step 数据契约）** | agent-first 最大短板 |
| M3.2 双轨历史合并 | **保留** | 必要卫生 |

### NOT in Scope
- 接付费 CAPTCHA、Web UI、TS 迁移、遥测
- bb.js 持久 session 改造（v2.x 周期内）
- `cli.js batch` 原生命令
- 适配器脚手架

### Next Skill：`plan-eng-review`

---

## Eng Review（技术评审）

评审范围：CEO 砍后的 M1 + M2 + M3.2

### Execution Scope Verdict
真实技术内容（HEAD 探活、文件锁、轮转、错误映射、双轨合并）—— eng review 适用。复杂度合理，无过度工程化。

### Architecture and Boundaries

**新增 4 个小工具，边界清晰**：
- `src/prune-dead.js` — 只管 targets.yaml 的 status
- `src/utils/lockfile.js` — **直接用 `proper-lockfile` npm 包，不要手写**
- `scripts/update-readme-stats.js` — 只读 targets.yaml + 写 README 占位
- `src/utils/cleanup.js` — screenshots / lockfile 清理

**责任边界纠偏**：
- `submit.js` 错误分支只产出 `nextSteps[]` **数据**，CLI 层负责渲染——这样 Claude 也能解析机器可读的 nextSteps
- HEAD 探活用 Node 内置 `fetch`，**不要引入 axios**

### Critical Data Flows

**Flow 1: prune-dead**
```
cli prune-dead [--apply]
  → 读 targets.yaml
  → 并发 HEAD（concurrency=10）
      ├── 4xx/5xx + 重试 3 次 → 候选 dead
      ├── 200/3xx → 跳过
      └── 网络错误 → 候选 dead（标 reason）
  → 输出候选清单（含 --json 模式）
  → if --apply: 备份 .bak → atomic write
```

**Flow 2: submissions.yaml 并发写**
```
recordSubmission()
  → lockfile.lock('submissions.yaml') [超时 30s]
      ├── 获锁 → read → append → atomic write → release
      └── 超时 → 抛错 + 提示 cleanup --locks
```

**Flow 3: 失败 next-step 数据流**
```
adapter.submit() throws ErrorWithCode(code)
  → submit.js 按 code 查 nextStepMap
  → 返回 { status:'failed', code, nextSteps:[{label, command}] }
  → tracker 记录
  → cli 层渲染（人类可读）；--json 输出（agent 可解析）
```

### Failure Modes and Recovery

| # | 场景 | 处理 |
|---|------|------|
| 1 | prune-dead 误判临时 503 | 重试 3 次 + 干跑默认 + 写前 .bak |
| 2 | lockfile 残留（kill -9） | 启动检查 mtime，>60s 视为僵尸锁清理 |
| 3 | submissions.yaml 损坏 | try-parse 失败 → 备份 → 初始化 + 警告 |
| 4 | targets.yaml 写入中断 | atomic write（`.tmp` + rename） |
| 5 | mark-* 命令误标 | 打印当前状态 + `--yes` 确认 + 写前 .bak |
| 6 | screenshots 轮转误删 | 只删命名规则匹配的 |
| 7 | loadAllHistory 每次重读 76KB | mtime 缓存 |

### Test and Observability Requirements

**最小测试矩阵**：

| 模块 | 测试用例 |
|------|---------|
| `prune-dead.js` | mock fetch（4xx/5xx/200/timeout）；--dry-run 不写；--apply 写 .bak |
| `lockfile` | 并发 10 个 recordSubmission 无损坏；僵尸锁清理 |
| `submit.js` 错误映射 | 4 类错误码各一，nextSteps 符合预期 |
| `loadAllHistory()` | YAML+JSON 合并去重；mtime 缓存命中 |
| `mark-*` | 写前 .bak；非 --yes 不生效 |

**Observability**：
- prune-dead 加 `--json` 输出
- submit 失败时 nextSteps 写入 submissions.yaml（事后审计）
- 加 `cli.js stats` 含 success rate by site/day + **timing 维度**——既是隐性卖点，也是 M4 改造决策的数据来源

### Next Skill：`writing-plans`

---

## 评审结论

**原方案打分**：6/10

| 部分 | 评分 | 处置 |
|------|------|------|
| M1 卫生整顿 | A | 保留 |
| M2 UX 闭环 | A（强化数据契约后） | 保留+强化 |
| M3.1 原生 batch 命令 | B-（定位冲突） | 降级到 CLAUDE.md 指引 |
| M3.2 双轨合并 | A | 保留 |
| M3.3 重命名 | C（破坏性收益小） | 删除 |
| M4 持久 session | 先别做（无数据） | 移出 v2.x，先量化 |

**3 个核心 delta**（已同步到原方案）：

1. **删 M4 持久 session** → 没有性能测量数据前不重构。先做 `cli.js stats --timing` 跑 10 站基线。
2. **降级 M3.1** → 改成 CLAUDE.md 加「批量提交指引」一节，0 代码改动。
3. **强化 M2 next-step 数据契约** → 错误分支返回机器可读 `nextSteps[]`，CLI 渲染、Claude 解析双用。

**新排期**：1 周内发 v2.2.0（M1 + M2 + M3.2），不再纠结 v3.0。
