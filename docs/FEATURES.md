# Backlink Pilot — 功能清单（FEATURES）

> **这是一份跨周期的 Live 活文档**，不随 PRD 升版归档。
> PRD 记录「某一版计划做什么」，FEATURES 记录「现在实际有什么、砍了什么、还想做什么」。
> 产品方向原则与否决的方向 → 见 [METHODOLOGY.md](METHODOLOGY.md)，本文件只记**具体功能**。
>
> - 首次盘点日：2026-06-03（v2.2 基线 + 2026-04 批量架构升级批次）
> - 抽取来源：plans 交接/验收文档 + agent-manifest.json + `src/cli.js` 代码核实
> - 注：本项目是**本地 CLI 工具**，无线上站点，状态判定的最终裁判是 `src/cli.js` 与 `src/` 代码，不是文档措辞

## 图例

| 标记 | 含义 |
|---|---|
| `[x]` | 已上线 — 代码接通 + 命令可跑 |
| `[~]` | 半成品 — 代码写了但覆盖不全 / 后端未接全 / 有门面无完整实现 |
| `[ ]` | 计划中 — 有归属或门槛，尚未动工 |
| `[-]` | 已取消 — 计划过但砍了，保留条目 + 原因 |

---

## 功能清单

### A. 提交核心

| 能力 | 状态 | 加入 | 备注 |
|---|---|---|---|
| `submit <site\|url>` 单站提交（已知 adapter 或 generic） | [x] | v2.1 | submissions.yaml 累计 159 条提交记录 |
| generic 通用表单适配器（任意目录站自动填表） | [x] | v2.1 | `src/sites/generic.js` |
| 站点专用 adapter：futuretools / aivalley / saashub / uneed / baitools / startup88 | [x] | v2.1 | `src/sites/` 6 个 |
| `batch-submit` 目录批量执行器（dedup gate by site+productHash、value_tier 排序、`--force`、`--yes` 安全门、真实运行默认 limit 5） | [x] | v2.3（2026-04） | 代码完整 + 28 测试。**备注：历史文档验收全为 `--dry-run`，真实非 dry-run 提交链路尚未经文档化验收** |
| Recipe Adapter 层（YAML 声明式配方，`form-recipe` + `recipe-loader`） | [x] | v2.3（2026-04） | 引擎完整。**当前仅 2 个配方**（futuretools / aivalley），覆盖面待扩 |
| Provider Adapter 层（识别第三方表单 iframe → 提取 src → 直接打开表单 URL） | [~] | v2.3（2026-04） | **只实现 Paperform 一站**；Tally / Typeform / Airtable 已排序未接（见「计划中」） |
| blog 评论批量提交（5 人格轮换 + 20 条自然模板 + 15–45s 抖动 + 双轨去重） | [x] | v2.1（v2.3 拆分独立文件） | `src/batch-blog-comments.js` 完整。**⚠️ 文档过时**：AGENT_GUIDE 指向的命令名仍是 `src/batch-submit.js`（该文件已被重写为目录执行器），实际入口是 `node src/batch-blog-comments.js`；且 `cli.js` 未暴露此子命令 —— 待修文档 |
| checkbox 分级勾选（仅 `tos`/`privacy` 允许勾选，newsletter/marketing 永禁，loader 层强制） | [x] | v2.3（2026-04） | ADR-009，`recipe-loader.js` schema 拦截 |
| color CAPTCHA 自动解（「点某颜色按钮」类） | [~] | v2.1 | `src/captcha.js` 只解颜色验证码；Turnstile / reCAPTCHA 一律 fail-fast 跳过 |

### B. 侦察与分类

| 能力 | 状态 | 加入 | 备注 |
|---|---|---|---|
| `scout <url> --deep` 站点侦察（字段枚举 / 登录检测 / 截图） | [x] | v2.1 | `src/scout/discover.js` |
| `triage` 分桶分类（HTTP + `--browser` 双模式，6 桶模型 + value_tier，`--json`/`--output`/`--limit`/`--category`） | [x] | v2.3（2026-04） | criterion 1/2/3 验收，226 测试 |
| `doctor` 环境自检（Node / bb-browser / Chrome / config，每项带 fix 提示） | [x] | v2.2 | `src/doctor.js` |

### C. 状态与追踪

| 能力 | 状态 | 加入 | 备注 |
|---|---|---|---|
| `status` 提交历史（目录 + blog 评论双轨合并 `loadAllHistory`） | [x] | v2.2 | `src/tracker.js` |
| `stats --timing` 成功率 + p50/p95 每次提交耗时 | [x] | v2.2 | `src/stats.js` |
| `mark-done <site>` 手动记录一次成功提交 | [x] | v2.2 | — |
| 双轨去重（submissions.yaml + global-history.json，by site + productHash） | [x] | v2.2 | 跨命令避免重复提交 |
| 文件锁 + atomic write（proper-lockfile，并发写不损坏） | [x] | v2.2 | — |

### D. 失败自我修正 / verdict 层

| 能力 | 状态 | 加入 | 备注 |
|---|---|---|---|
| 失败自动裁决回写 targets.yaml（VERDICT_TABLE + streak 门槛防瞬时故障 + 字段级防退化） | [x] | v2.3（2026-04-28） | 验收 8/8；单轮成功率 17%→50%，稳态预估 60–70% |
| `locked` 列出 verdict 层锁定的站（按 code 分桶：PAGE_404 / IFRAME_FORM / NO_FIELDS / LOGIN_REQUIRED / PAID_WALL / UNKNOWN_ERROR） | [x] | v2.3（2026-04-28） | — |
| `unlock <site> --yes` 解锁重试（修好底层问题后恢复 auto:yes） | [x] | v2.3（2026-04-28） | — |
| `mark-dead <site>` / `mark-manual <site>` | [x] | v2.2 | — |
| 失败 nextSteps 数据契约（`classifyError` → `{code, nextSteps[]}` + `--json` 结构化载荷） | [x] | v2.2 | exit 1 同时打印结构化 JSON 到 stdout |

### E. 目标库维护

| 能力 | 状态 | 加入 | 备注 |
|---|---|---|---|
| targets.yaml 目标站库（258 站，含 auto / status / value_tier / auto_blocked_reason） | [x] | v2.1 起持续维护 | 当前 143 auto:yes、47 dead |
| `prune-dead` 死站探活清理（HEAD 并发探活 + `--apply` + 自动 .bak 备份） | [x] | v2.2 | M1.1 验收 |
| `bb-update` 拉取 bb-browser 社区适配器（24h 节流） | [x] | v2.1 | `src/bb-update.js` |
| `cleanup` 截图轮转（`--keep-days`）+ 僵尸锁清理（`--locks`） | [x] | v2.2 | — |

### F. 周边 SEO

| 能力 | 状态 | 加入 | 备注 |
|---|---|---|---|
| `awesome <repo>` 生成 awesome-list GitHub Issue body（10 个 repo 预配） | [x] | v2.1 | `src/awesome/templates.js` |
| `indexnow <url>` 推送 Bing / Yandex 索引 | [x] | v2.1 | `src/indexnow.js` |

### G. Agent 接入层

| 能力 | 状态 | 加入 | 备注 |
|---|---|---|---|
| AGENT_GUIDE.md 单一权威源 + 4 个 redirect stub（CLAUDE / AGENTS / .cursorrules / copilot-instructions） | [x] | v2.3（2026-04-28） | 验收 9/9 |
| agent-manifest.json 机器可读命令契约 | [x] | v2.3（2026-04-28） | **⚠️ 内容已滞后**：仅列 8 命令，缺 awesome / indexnow / bb-update / stats / cleanup / prune-dead / mark-* —— 待补全 |
| exit code 0/1 契约 + `--json` 结构化失败载荷 | [x] | v2.3（2026-04-28） | exit code 2（transient 态）已决定不引入，见「已取消」 |

---

## 已取消 [-]（具体功能，保留 + 原因）

> 方向层面的否决（不做 Web UI、不接付费 captcha、不加遥测等）不在此列 —— 见 [METHODOLOGY.md](METHODOLOGY.md)。

| 功能 | 原因 | 出处 |
|---|---|---|
| `cli.js batch` 原生批量命令 | agent-first 定位下 Claude 已是事实调度器，再造原生批量是「发明平行系统」 | 优化方案 D2 + 评审 |
| playwright 引擎 | 事实退役、仍占 ~45MB；v2.2 物理移除，唯一引擎 bb-browser | 优化方案 M1.2 |
| 手写 180 个 site-specific adapter | 成本过高且大量站点已死/低价值；改用 recipe 层吸收 | 架构评估方案 |
| 「JS-first 跑稳再迁 YAML」两步走 recipe 存储 | 一旦 JS 配方跑稳，迁 YAML 会变成纯成本动作被永久搁置；从一开始就 YAML 切断该陷阱 | ADR-006 |
| `--force all` 全量强制重提 | 防误清，必须显式列出具体 siteKey | ADR-010 |
| exit code 引入 2（transient 态） | 避免逐处审计 `process.exit` 引回归；按现状用 0/1 约定 | 跨agent通用化协议 |

---

## 计划中 [ ]（有归属/门槛，未动工）

| 功能 | 触发门槛 / 归属 | 出处 |
|---|---|---|
| `scaffold-adapter` 适配器脚手架命令 | v3.0 候选池，门槛：累计 ≥5 个外部贡献者 PR | 优化方案 + 技术架构分析 |
| `.claude-local.md` 自动初始化 | CLAUDE.md 已提及，未实现 | 技术架构分析 |
| bb.js 持久 session / 长连接 RPC | v3.0 候选池，门槛：单站 p95 > 60s 或批量 10 站 > 30min（需先有耗时数据） | 优化方案 v3.0 |
| Tally / Typeform / Airtable provider adapter | Paperform 之后下一批，命中多个高价值站点时投入 | 架构评估方案 |
| 更多高价值站 adapter（Futurepedia / Product Hunt / Toolify） | 按站点价值排序的 backlog，未排期 | 批量提交优化方案 |
| 专用 iframe / SPA adapter（「A 方案」） | 突破当前 ~70% 成功率上限（剩余被 iframe / 强 captcha 锁住） | 提交失败自我修正闭环 |

---

## 点子收件箱

> 散在 plans 交接、实战日志、历史讨论里「提过但没排期」的想法。进了这里只代表「记下来了」，不代表会做。
> 拍板要做 → 升级进「计划中」；判定为方向性否决 → 移交 [METHODOLOGY.md](METHODOLOGY.md)。

| 想法 | 加入 | 备注 |
|---|---|---|
| 把「直投路径」沉淀进 CLI：纯 HTML POST / 抠前端 JSON API / 第三方真表单（Tally·金数据·MikeCRM·Wufoo） | 2026-06-03 | 出自 2026-05-04 实战日志，**命中率最高的路径**，但当前由手工 Computer Use 完成，未产品化进 CLI/recipe |
| targets.yaml 半自动发现新站 | 2026-06-03 | 门槛：用户增长到 500+ 站需求才启动（v3.0 候选） |
| 上传型高价值站点回头处理（logo 强制上传阻断当前一律降优先级） | 2026-06-03 | 实战日志：只有上传型目录站明显高价值时再回头 |
| bb-browser 上游版本锁定 | 2026-06-03 | 当前 `npm install -g` 不锁版本，破坏性更新会坑到所有用户；只记录未立项 |
| 文档全面国际化（README 已 EN/ZH，其余文档未跟上） | 2026-06-03 | 优化方案「后续观察项」，未立项 |
| 加新 agent 工具（Cursor / Copilot / Aider 等）只写一个 stub | 2026-06-03 | 接入层已留扩展位，零成本接入；待有需求时执行 |
| 「AI 接入层」单一权威源模式复用到其他项目 | 2026-06-03 | 跨项目方向外溢设想 |

---

## 维护约定

- 新功能落地 → 在对应领域表加一行，标 `[x]` + 版本/月份
- 砍掉某功能 → 移到「已取消」并写原因，**不删条目**
- 收件箱想法被排期 → 移到「计划中」；被判方向否决 → 移到 METHODOLOGY
- 状态判定有疑时，以 `src/` 代码为准，不以文档措辞为准
