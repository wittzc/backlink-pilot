# Backlink Pilot v2.1 → v2.2 优化方案

> 立项日期：2026-04-26
> 配套分析：[2026-04-26-项目分析与用户视角.md](../research/2026-04-26-项目分析与用户视角.md)
> 评审记录：[2026-04-26-backlink-pilot-优化方案-评审.md](2026-04-26-backlink-pilot-优化方案-评审.md)
> 状态：已评审 + 已修订（rev 2）

---

## Delta Summary（rev 1 → rev 2，2026-04-26）

经 `plan-ceo-review` + `plan-eng-review` 评审后修订。

### 已接受的 delta

| Delta | 决策 | 理由 |
|-------|------|------|
| **D1：删 M4 持久 session** | 从 v2.x 周期移出，作为 v3.0 候选池条目；门槛改为「先有性能基线数据」 | 没有「单站实际耗时 / 批量 10 站总耗时」数据前不动核心子进程模型；CLAUDE.md 自己规定 pacing 5-10 站，性能问题可能不存在 |
| **D2：降级 M3.1 原生 batch 命令** | 改为在 CLAUDE.md 加「批量提交指引」一节，0 代码改动 | agent-first 定位下，Claude 已是事实上的批量调度器，再造 `cli.js batch` 是发明平行系统 |
| **D3：强化 M2 next-step 数据契约** | 错误分支返回机器可读 `nextSteps[]` 结构，CLI 与 Claude 双用 | agent-first 工具的关键差异化——失败时 Claude 也能解析下一步动作 |
| **D4：删 M3.3 文件重命名** | 不做 | 破坏性改动，受益人少，收益不抵迁移成本 |
| **D5：新增 M3.0 基线测量** | 加 `cli.js stats --timing` 命令 | 既是 v2.3 隐性卖点（用户可见 success rate），也是 D1 改造决策的数据闸门 |
| **D6：lockfile 用成熟库** | 直接用 `proper-lockfile` npm 包，不手写 | 文件锁是经典坑，不重新造轮子 |

### Superseded 决策（rev 1 的内容已废弃）

- ~~M3.1 `cli.js batch --filter <DSL>`~~ → 改为 CLAUDE.md 文档指引（M3.0a）
- ~~M3.3 `batch-submit.js` → `batch-comments.js` 重命名~~ → 不做
- ~~M4 bb.js 持久 session（v3.0 2-3 周排期）~~ → 移出当前周期，进 v3.0 候选池待数据

### 仍开放的问题

- bb-browser 是否支持长连接 / RPC 模式（M4 调研项，但已不阻塞 v2.2）
- targets.yaml 半自动维护（写在 § 12「后续观察项」，不立项）

### 影响的下游执行范围

- 排期从「1 周 v2.2 + 2-3 周 v3.0」收敛为「1 周 v2.2」
- 验收清单从 9 条收敛为 7 条

---

## 0. 总览

### 目标

把 Backlink Pilot 从「能用」推进到「丝滑 + agent 友好 + 长期可持续」。**1 周内发 v2.2.0**。

### 范围

| ✅ 做（v2.2） | ❌ 不做（明确拒绝） |
|------|--------|
| 卫生整顿（README、dead 站、playwright 剥离、文件锁、轮转） | 接付费 CAPTCHA 服务（与免费定位冲突） |
| 失败链路闭环 + **机器可读 nextSteps 数据契约** | 适配器脚手架（贡献者不足，过早优化） |
| CLAUDE.md 加「批量提交指引」（替代原生 batch 命令） | Web UI / 服务化（违反 CLI/agent-first 定位） |
| 双轨历史合并 | 改 ESM → CJS / 迁 TS |
| 基线测量 `cli.js stats --timing`（D1 数据闸门） | bb.js 持久 session 改造（v2.x 周期内） |
|  | `cli.js batch` 原生命令（Claude 已能做） |

### 成功标准

- v2.2 发布后：纯 CLI 用户可一行命令批量提交（通过 Claude），失败有机器可读引导，README 数字与代码自洽
- 性能基线数据落地（`cli.js stats --timing`），为 v3.0 是否启动 M4 提供决策依据

---

## 里程碑 M1 — 卫生整顿（Day 1，3 个独立 PR）

### M1.1 README 数字自洽 + dead 站清理命令

**症状**：
- README 写「226 auto-submittable」，实际 `auto: yes` 仅 180
- 45 个 `status: dead` 站每次让 Claude 重新判断，token 浪费

**改动**：

| 文件 | 改动 |
|------|------|
| [src/cli.js](../../src/cli.js) | 加 `prune-dead` 子命令 |
| `src/prune-dead.js`（新增） | 用 Node 内置 `fetch` HEAD 探活；并发 10；重试 3 次；4xx/5xx/网络错误 → 候选 dead |
| `scripts/update-readme-stats.js`（新增） | 读 targets.yaml → 替换 README 数字占位 |
| [README.md](../../README.md) / [README.zh.md](../../README.zh.md) | 数字改成 `<!-- stats:auto-yes -->180<!-- /stats -->` 占位形式 |

**用法**：
```bash
node src/cli.js prune-dead              # 干跑，输出候选清单
node src/cli.js prune-dead --json       # 干跑 + 结构化输出（agent 可解析）
node src/cli.js prune-dead --apply      # 备份 .bak → atomic write
node scripts/update-readme-stats.js     # 更新 README 数字
```

**验收**：
- `prune-dead` 默认干跑，输出候选清单 + reason
- 写入用 atomic write（`.tmp` + rename）+ `.bak` 备份
- 临时 5xx 不会误判（重试 3 次）
- README 数字与 targets.yaml 一致

### M1.2 剥离 playwright 引擎

**症状**：playwright 事实退役，仍在 `package.json`，`npm install` 拖 ~45MB

**改动**：

| 文件 | 改动 |
|------|------|
| [package.json](../../package.json) | 移除 `playwright` 和 `rebrowser-playwright` |
| [src/browser.js](../../src/browser.js) | 检测到 `--engine playwright` → deprecation warning + 退出码 1 |
| [src/cli.js](../../src/cli.js) | `--engine` 参数文档说明只支持 `bb` |
| [README.md](../../README.md) / [docs/guide.md](../guide.md) | 删 Engine Comparison 表 |

**验收**：
- `npm install` 总大小减少 ≥ 40MB
- `submit foo --engine playwright` 输出明确 deprecation 信息

**风险**：可能有用户仍在用 playwright → v2.2 只 warn 不删代码路径，v3.0 物理删

### M1.3 文件锁 + screenshots 轮转

**症状**：
- submissions.yaml 整体读改写，并发跑会损坏
- screenshots/ 无限增长

**改动**：

| 文件 | 改动 |
|------|------|
| [package.json](../../package.json) | 加 `proper-lockfile` 依赖 |
| [src/tracker.js](../../src/tracker.js) | 写入用 `proper-lockfile.lock` + atomic write；启动检查僵尸锁（mtime > 60s 自动清） |
| [src/sites/generic.js](../../src/sites/generic.js) | screenshot 命名 `{site}-{date}.png`，覆盖同站当日截图 |
| `src/utils/cleanup.js`（新增） | `cli.js cleanup --keep-days 30` 清理老截图；`cli.js cleanup --locks` 清理僵尸锁 |

**验收**：
- 两终端并发 submit，submissions.yaml 不损坏
- screenshots/ 增长曲线收敛
- 只删 `{site}-{date}.png` 命名规则匹配的，不动用户手动保存的文件

---

## 里程碑 M2 — UX 闭环 + 数据契约（Day 2）

### M2.1 失败 nextSteps 数据契约（核心强化项 D3）

**改动**：[src/submit.js](../../src/submit.js) 错误分支统一返回机器可读结构。

```js
// 错误返回结构（写入 submissions.yaml + 终端渲染）
{
  status: 'failed',
  code: 'PAGE_404' | 'LOGIN_REQUIRED' | 'CAPTCHA_FAILED' | 'CHROME_TIMEOUT',
  nextSteps: [
    { label: '标记死站', command: 'cli.js mark-dead saashub' },
    { label: '改手动', command: 'cli.js mark-manual saashub' }
  ]
}
```

**职责边界**：
- `submit.js` 只产出数据，**不渲染**
- CLI 层渲染人类可读输出
- `--json` 模式直出 JSON（Claude 可解析）

**错误 → nextSteps 映射**：

| code | nextSteps[] |
|------|-------------|
| `PAGE_404` | `mark-dead <site>` |
| `LOGIN_REQUIRED` | `mark-manual <site>` |
| `CAPTCHA_FAILED` | `open screenshots/<site>-<date>.png` + `mark-done <site>` |
| `CHROME_TIMEOUT` | `pkill -f bb-browser && bb-browser open about:blank` |

**新命令**：
- `cli.js mark-dead <site>` — 改 targets.yaml 的 status（要 `--yes` 确认）
- `cli.js mark-manual <site>` — 改 auto 字段
- `cli.js mark-done <site>` — 手动写入 submissions.yaml

**验收**：模拟 4 类失败，每类都有可执行 nextSteps，且 `--json` 模式 Claude 能解析

### M2.2 `cli.js doctor` 健康自检

**改动**：[src/cli.js](../../src/cli.js) 加 `doctor` 命令，输出含 `→ fix:` 提示。

```
✓ Node 18.20.0
✓ bb-browser 0.10.3 installed
✗ Chrome not running        → fix: bb-browser open about:blank
⚠ 3 stale lock files        → fix: cli.js cleanup --locks
✓ config.yaml valid
✓ submissions.yaml writable
```

**验收**：每个失败项都有 `→ fix:` 提示，复制粘贴即可

---

## 里程碑 M3 — 历史统一 + 批量指引 + 基线测量（Day 3-4）

### M3.0a CLAUDE.md 加「批量提交指引」（D2 落地，0 代码）

**改动**：[CLAUDE.md](../../CLAUDE.md) 在「When User Says...」表后新增 § Batch Submission Playbook：

```markdown
## Batch Submission Playbook

When user asks to submit to multiple sites (「提交到所有免费站」/「批量提交」):

1. Run `cli.js status` — 看已提交，避免重交
2. Read targets.yaml — 筛 `auto: yes` 且非 `status: dead/paid`
3. 默认 limit 10 站/会话（用户可覆盖）
4. 逐站调 `submit <name> --engine bb`，间隔 60-180s 随机
5. 每站后看 nextSteps[]：
   - 若 PAGE_404 → 自动调 `mark-dead`
   - 若 LOGIN_REQUIRED → 跳过 + 标 manual
   - 若成功 → 继续下一站
6. 全跑完输出汇总：成功 X / 失败 Y / 跳过 Z
```

**验收**：
- 用户说「批量提交到免费站」，Claude 按指引循环 submit，无需写代码
- 失败时根据 nextSteps[] 自动决策

### M3.0b `cli.js stats --timing` 基线测量（D5 新增）

**目的**：为 D1（M4 持久 session）改造提供数据闸门。

**改动**：

| 文件 | 改动 |
|------|------|
| [src/tracker.js](../../src/tracker.js) | recordSubmission 增加 `duration_ms` 字段 |
| [src/submit.js](../../src/submit.js) | 包 try/finally 计时 |
| `src/stats.js`（新增） | 统计 success rate by site/day + p50/p95 timing |

**用法**：
```bash
cli.js stats                   # 总览
cli.js stats --timing          # 含 p50/p95 耗时
cli.js stats --timing --json   # 结构化输出
```

**验收**：
- 跑过 ≥ 10 站后 `stats --timing` 输出 p50/p95
- 数据落 submissions.yaml，不引入额外文件

### M3.1 双轨历史合并（D2 配套必做）

**症状**：单站走 submissions.yaml，批量评论走 logs/global-history.json，跨命令查重失效

**方案**：
- **保留物理两份**（batch-comments 高频写需要 JSON 性能）
- [src/tracker.js](../../src/tracker.js) 加 `loadAllHistory()` 函数，合并两份 + mtime 缓存
- 所有去重逻辑统一调用此函数

**验收**：
- batch-submit.js 提交过的，`cli.js status` 也能查到
- Claude 按 M3.0a 指引循环时不会重交

---

## 排期

```
Day 1: M1.1 + M1.2 + M1.3       （3 个独立 PR，可并行）
Day 2: M2.1 + M2.2              （UX + 数据契约）
Day 3: M3.0a + M3.0b + M3.1     （指引 + 基线 + 双轨合并）
Day 4: 集成测试 + 修 bug
Day 5: 发布 v2.2.0
```

**依赖关系**：
- M1 / M2 / M3 之间互相独立
- M3.0a 依赖 M2.1（要先有 nextSteps 才能在指引里用）
- M3.0b 依赖 M1.3（要先有 lockfile 才敢加 duration 字段并发写）

---

## 验收清单（v2.2.0 发布前必过）

- [ ] `npm install` 大小减少 ≥ 40MB
- [ ] README 所有数字与 targets.yaml 一致（脚本可重复生成）
- [ ] `cli.js prune-dead` 干跑准确（手验 5 站 + 重试 3 次正常）
- [ ] 两终端并发 submit，submissions.yaml 不损坏
- [ ] 4 类失败场景都有 nextSteps[]，`--json` 模式 Claude 可解析
- [ ] `cli.js doctor` 检测出真实环境问题，每项有 `→ fix:`
- [ ] CLAUDE.md「Batch Submission Playbook」可被 Claude 正确执行（手验：让 Claude 按指引提交 3 站）
- [ ] `cli.js stats --timing` 输出 p50/p95（跑过 ≥ 10 站后）
- [ ] 所有现有 `npm test` 通过
- [ ] 新增测试：prune-dead / lockfile / nextSteps 映射 / loadAllHistory / mark-* / stats

---

## 不做的事（拒绝列表）

| 提议 | 拒绝理由 |
|------|----------|
| 接 2Captcha / Anti-captcha | 与「免费工具」定位冲突 + 引入扣费 API 风险 |
| 重写 TS | 当前 ESM JS 稳定，迁移成本不抵收益 |
| Web UI | 项目定位 CLI/agent-first |
| 替换 bb-browser | 反检测核心能力依赖它 |
| 适配器脚手架 | 贡献者少，过早优化 |
| 加遥测 / 数据上报 | 隐私敏感，违反本地工具用户预期 |
| **`cli.js batch` 原生命令** | Claude 已能做，重复造轮子（D2） |
| **bb.js 持久 session 改造（v2.x 周期）** | 无性能基线数据（D1，等 M3.0b 数据） |

---

## v3.0 候选池（不立项，待数据）

启动前提：M3.0b 跑出的基线数据显示**单站 p95 > 60s** 或**批量 10 站 > 30 分钟**。

| 候选项 | 估时 | 启动门槛 |
|--------|------|---------|
| bb.js 持久 session 改造（D1） | 2-3 周 | 性能基线触发 + bb-browser 长连接调研通过 |
| 适配器脚手架 `cli.js scaffold-adapter` | 3-5 天 | 累计 ≥ 5 个外部贡献者 PR |
| targets.yaml 半自动发现 | 1-2 周 | 用户增长到需要 500+ 站点 |

---

## 后续观察项（不立项，先记录）

- targets.yaml 维护成本：259 站手维护吃力
- bb-browser 上游版本变更：当前 `npm install -g` 不锁版本，破坏性更新会让所有用户受害
- 国际化：当前 README 已 EN/ZH 双轨，文档其他部分还没

---

## Contract Readiness Check（plan-contract-governor）

执行前确认：

- [x] 单一 canonical doc（本文件）
- [x] Delta Summary 完整（rev 1 → rev 2）
- [x] 评审记录已持久化（[评审备忘](2026-04-26-backlink-pilot-优化方案-评审.md)）
- [x] superseded 决策明确标记
- [x] 验收标准可测量
- [x] 拒绝列表显式
- [x] 排期与依赖清晰

→ **可进入 `executing-plans`**
