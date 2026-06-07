# Backlink Pilot — 产品方法论（METHODOLOGY）

> **这份文件记「为什么这么做」与「不做什么方向」**，是产品的方向边界。
> 具体功能的状态（有什么 / 砍了什么 / 想做什么）→ 见 [FEATURES.md](FEATURES.md)。
> 划界规则：**否决某个方向**记这里；**砍掉某个具体功能**记 FEATURES 的「已取消」。
>
> 首次整理日：2026-06-03，来源 docs/plans/ 历次方案、评审与 ADR。

## 产品定位

backlink-pilot 是一个**免费、本地运行、agent-first 的外链批量提交工具**，面向 indie hacker —— 帮用户把自己的产品提交到目录站 / awesome-list，用最少的人力拿到外链。

定位决定了下面所有方向原则与否决项。每条否决都能回推到这句定位里的某个词：**免费**、**本地**、**agent-first**。

## 方向原则（做什么、怎么做）

### 1. Agent-first，不造平行调度系统
Claude / AI agent 就是这个工具事实上的批量调度器。需要「批量、节流、去重、按优先级排序」的编排逻辑，优先写成 **agent 能读的文档指引**（AGENT_GUIDE 的 Batch Playbook），而不是再造一个 `cli.js batch` 原生命令。
> 推论：拒绝 Web UI / 服务化 —— 见 Non-Goals。

### 2. 数据闸门式立项，没数据不动核心
性能类、架构类的改动（如 bb.js 持久 session）**先立门槛、后看数据**，没有「单站实际耗时 / 批量 N 站总耗时」数据前不动核心子进程模型。CLAUDE.md 自己规定了 pacing（5–10 站/场），性能瓶颈可能根本不存在。
> 体现：v3.0 候选池每项都挂了量化门槛（≥5 PR / p95>60s / 500+ 站），达标才启动。

### 3. Recipe-over-adapter，用配方吸收长尾
不手写大量 site-specific adapter（成本过高且多数站点已死/低价值）。长尾站点用 **YAML 声明式 recipe** + **provider 识别**（第三方表单 iframe → 直开 URL）吸收，把「写代码」降级成「填配方」。

### 4. 单一权威源，不让指令漂移
AI agent 指令只有一份真相源（`docs/AGENT_GUIDE.md`），其余入口文件（CLAUDE.md / AGENTS.md / .cursorrules / copilot-instructions.md）都是 redirect stub。N 份独立 instruction 必然漂移 —— 这事已经发生过（AGENTS.md 曾把 `.claude-local.md` 错写成 `.Codex-local.md`）。
> 推论：接新 agent 工具只加一个 stub，不复制一份指令。

### 5. Fail-fast，不硬突破障碍
遇到 CAPTCHA / 登录墙 / 付费墙，**一律 fail-fast 退到 manual-review**，不硬解、不绕过。verdict 层把这类失败分类、回写 targets.yaml，让 auto:yes 池自我收敛，而不是投入资源去攻破单个障碍。

### 6. 内容按渠道适配，不一稿通投
同一产品提交到不同目录站，文案应按站点画像（`niche` + `lang`）差异化——卖点角度、话术调性、语言各有侧重。一稿通投不仅相关性差（不同站点要的东西不同），完全相同的文案投几十站本身就是 spam 信号、压低收录质量。差异化文案由 **agent 运行时生成**（呼应原则 1：零额外 API 成本，代码只供料 + 填充），不在代码里调扣费 API。
> 体现：targets.yaml 的 `niche` 字段 + AGENT_GUIDE 的 Niche-driven Content playbook + `submit --description-file`。

## Non-Goals（明确否决的方向）

下面是**反复被提出、且已明确否决**的方向。记在这里是为了不重复讨论 —— 再有人提，先读这一节。

| 否决方向 | 原因 | 回推到定位 |
|---|---|---|
| **Web UI / 服务化** | 项目定位 CLI / agent-first，GUI 是另一个产品 | 本地、agent-first |
| **接付费 CAPTCHA（2Captcha / Anti-captcha 等）** | 与「免费工具」定位冲突，且引入按量扣费 API 风险 | 免费 |
| **遥测 / 数据上报** | 隐私敏感，违反本地工具用户的预期 | 本地 |
| **迁 TypeScript / 迁 CJS** | 当前 ESM JS 稳定，迁移成本不抵收益 | （工程取舍） |
| **替换 bb-browser** | 反检测是核心能力，依赖 bb-browser | （核心依赖） |
| **绕过 CAPTCHA / 登录 / 付费提交** | Non-Goal，检测到一律 fail-fast 进 manual-review；不自动处理需登录或付费的入口 | 免费、合规 |

## 与 FEATURES 的关系

- 某个 Non-Goal 将来被推翻（定位变了）→ 在这里改，并在 FEATURES 开对应功能条目
- FEATURES 收件箱里的某个想法被判定为「方向性不做」→ 移来这里的 Non-Goals
- 砍掉一个**具体功能**（而非一个方向）→ 记 FEATURES 的「已取消」，不记这里
