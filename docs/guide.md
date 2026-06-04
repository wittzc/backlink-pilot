# 使用指南

Backlink Pilot v2.1 完整使用指南。按你的情况选一条路径：

| 路径 | 适合谁 | 耗时 |
|------|--------|------|
| [A. Claude Code](#a-claude-code-recommended) | 已装 Claude Code | 2 分钟 |
| [B. CLI Manual](#b-cli-manual) | 开发者，想完全掌控 | 10 分钟 |
| [C. OpenClaw](#c-openclaw-skill) | OpenClaw 用户 | 5 分钟 |

---

## A. Claude Code (Recommended)

> **前置条件：** [Node.js 18+](https://nodejs.org/) + [Claude Code](https://claude.ai/code)

### 第 1 步：Clone 项目

```bash
git clone https://github.com/s87343472/backlink-pilot.git
cd backlink-pilot
npm install
```

### 第 2 步：打开 Claude Code

```bash
claude
```

Claude 会自动读取 `CLAUDE.md`，了解整个项目。

### 第 3 步：对话

用自然语言告诉 Claude 你想做什么：

```
你：帮我把 [产品名] 提交到免费目录站
```

Claude 会：
1. 检查 `config.yaml` 是否存在，没有就问你 5 个问题再生成
2. 检查 `bb-browser` 是否装了，没装就引导你安装
3. 启动 Chrome，开始逐个提交
4. 每提交一个就汇报结果

**就这样。不用读文档，不用记命令。**

### 你可以对 Claude 说什么

| 你说 | Claude 做 |
|------|-----------|
| 帮我提交外链 | 引导配置，开始提交 |
| 提交到所有免费站 | 筛选 250+ 目标站，批量提交 |
| 这个站能提交吗？[URL] | 侦察该站，分析表单 |
| 提交情况 | 显示提交记录 |
| 帮我生成 awesome-list 提交 | 生成 GitHub Issue 内容 |
| 提交到 saashub | 提交到指定站点 |
| 外链策略建议 | 给出策略建议 |

### 用 Claude 排错

出问题时，直接告诉 Claude：

```
你：Chrome 连不上怎么办
你：提交失败了，报错 xxx
你：这个站要登录怎么办
```

Claude 知道 `CLAUDE.md` 里所有排错步骤。

---

## B. CLI Manual

> **前置条件：** [Node.js 18+](https://nodejs.org/) + [bb-browser](https://github.com/niciral/bb-browser)（推荐）

### 1. 安装

```bash
git clone https://github.com/s87343472/backlink-pilot.git
cd backlink-pilot
npm install
```

### 2. 安装 bb-browser

```bash
npm install -g bb-browser
bb-browser --version    # 应显示 0.10.x 以上
```

bb-browser 用你真实的 Chrome，绕过所有反爬检测、Cloudflare 和 OAuth。

### 3. 配置

```bash
cp config.example.yaml config.yaml
```

编辑 `config.yaml`：

```yaml
product:
  name: "Your Product Name"              # 产品名
  url: "https://your-product.com"        # 产品 URL
  description: "One-line description"     # 一句话描述（<160字符）
  long_description: |                     # 详细描述（2-3句）
    Your product helps [audience] do [thing].
    It features [key features].
  email: "hello@your-product.com"        # 联系邮箱
  categories: [developer-tools]           # 分类
  pricing: free                           # free | freemium | paid

browser:
  engine: bb                              # 推荐用 bb

utm:
  enabled: true                           # false = 不加 UTM 参数
  base_url: "https://your-product.com"
```

### 4. 启动 Chrome

```bash
bb-browser open about:blank
```

如果报错：
```bash
pkill -f "bb-browser" || true
bb-browser open about:blank
```

### 5. 提交

#### 提交到指定站点

```bash
# 已知适配器
node src/cli.js submit saashub --engine bb

# 任意目录站 URL（用 generic 适配器）
node src/cli.js submit https://any-directory.com/submit --engine bb
```

#### 提交到多个站点

```bash
# 逐个提交，每个间隔 1-3 分钟
node src/cli.js submit saashub --engine bb
# 等 1-2 分钟……
node src/cli.js submit uneed --engine bb
# 等 1-2 分钟……
node src/cli.js submit startup88 --engine bb
```

#### 批量博客评论

```bash
# 先空跑
node src/batch-submit.js --dry-run --limit 5

# 实际运行
node src/batch-submit.js --limit 10 --engine bb
```

### 6. 其他命令

```bash
# 侦察新站点，发现表单字段
node src/cli.js scout https://new-site.com --deep

# 生成 awesome-list 的 GitHub Issue 内容
node src/cli.js awesome awesome-cloudflare

# 向搜索引擎推送新页面
node src/cli.js indexnow https://your-site.com --key YOUR_KEY

# 查看提交记录
node src/cli.js status

# 更新 bb-browser 社区适配器
node src/cli.js bb-update
```

### 7. 站点适配器

内置适配器（在 `src/sites/`）：

| 适配器 | 站点 | 说明 |
|--------|------|------|
| `generic` | 任意 URL | 通用，配合 bb-browser |
| `saashub` | saashub.com | SaaS 目录站 |
| `uneed` | uneed.best | 工具站（DR 72） |
| `baitools` | baitools.com | AI 工具站 |
| `startup88` | startup88.com | 创业项目目录 |

没有专用适配器的站点，直接用 URL：

```bash
node src/cli.js submit https://any-site.com/submit --engine bb
```

### 8. 目标站点库

`targets.yaml` 收录 250+ 个目录站。可按以下字段筛选：

| 字段 | 取值 | 含义 |
|------|------|------|
| `auto` | yes / no | 是否可自动提交 |
| `status` | （空） / dead / paid | 站点状态 |
| `type` | form / github / email | 提交方式 |
| `lang` | en / zh | 语言 |

快速统计：
- **<!-- stats:auto-yes -->143<!-- /stats -->** 个可自动提交（`auto: yes`）
- **<!-- stats:dead -->47<!-- /stats -->** 个已确认失效（`status: dead`）
- **<!-- stats:paid -->7<!-- /stats -->** 个仅付费（`status: paid`）

---

## C. OpenClaw Skill

> **前置条件：** 已安装 [OpenClaw](https://openclaw.ai)

### 1. 链接 skill

```bash
ln -s ~/path/to/backlink-pilot ~/.openclaw/skills/backlink-pilot
```

### 2. 跟你的 Agent 对话

| 你说 | Agent 做 |
|------|----------|
| Submit to free directories | 配置后提交到所有免费站 |
| Submit to saashub | 提交到指定站点 |
| Scout https://site.com | 分析站点表单 |
| Show backlink status | 显示提交记录 |
| Generate awesome-cloudflare submission | 生成 GitHub Issue 内容 |

---

## 重要规则

1. **同一产品绝不向同一站点重复提交**
   - 先跑 `node src/cli.js status` 查
   - tracker 会自动去重

2. **控制提交节奏**
   - 不同站点之间间隔 1-3 分钟
   - 每天最多 5-10 次提交
   - 重试同一站点前先等 30-60 分钟

3. **始终用 bb-browser**
   - 加 `--engine bb`，或在 config 里设 `browser.engine: bb`
   - Playwright 会被多数现代反爬系统拦截

4. **提交前先检查**
   - v2.1 有预检 HTTP 请求（自动跳过 404/500）
   - 有些站点需要先手动登录 Google：`bb-browser open https://accounts.google.com`

5. **截图就是你的凭证**
   - 自动保存到 `./screenshots/`
   - 用来核对提交是否如预期生效

---

## 常见错误

| 错误 | 原因 | 解决 |
|------|------|------|
| "bb-browser cannot connect to Chrome" | Chrome 没运行 | `bb-browser open about:blank` |
| "Chrome may be unresponsive" | Chrome 进程卡死 | 杀掉 Chrome 再重启 |
| "404 — submit page gone" | 站点改了 URL | 手动访问根域名找新入口 |
| "Page redirected to login" | 站点要求账号 | 先登录或跳过 |
| "No recognizable form fields" | generic 适配器解析不了 | 先跑 `scout <url> --deep` |
| "CAPTCHA detected" | 站点有验证码 | 颜色验证码自动解，其余跳过 |
| "UTM params rejected" | 站点拒绝 query 参数 | config 里设 `utm.enabled: false` |

> 完整排错笔记：[troubleshooting.md](./troubleshooting.md)

---

## 文件说明

```
config.yaml              ← 你的产品配置（gitignored，私有）
config.example.yaml      ← 复制用的模板
targets.yaml             ← 250+ 目标站点及状态元数据
submissions.yaml         ← 自动生成的提交记录

src/cli.js               ← CLI 入口（所有命令）
src/submit.js            ← 提交调度器 + 预检
src/bb.js                ← bb-browser 封装（BbPage API）
src/browser.js           ← 双引擎管理器（bb + playwright）
src/sites/generic.js     ← 任意目录站的通用适配器
src/sites/*.js           ← 站点专用适配器
src/scout/discover.js    ← 表单字段发现
src/captcha.js           ← 验证码求解器
src/tracker.js           ← 提交去重追踪
src/indexnow.js          ← 搜索引擎推送
src/batch-submit.js      ← 批量博客评论提交器

CLAUDE.md                ← 给 Claude Code AI agent 的指令
docs/                    ← 文档站（VitePress）
```

---

## 日常工作流示例

```bash
# 早上：查看已经提交了哪些
node src/cli.js status

# 从 targets.yaml 找 5 个今天要提交的站

# 启动 Chrome
bb-browser open about:blank

# 逐个提交，留间隔
node src/cli.js submit saashub --engine bb
# 等 2 分钟……
node src/cli.js submit https://findmyaitool.com/submit --engine bb
# 等 2 分钟……
node src/cli.js submit https://toolpilot.ai/submit --engine bb

# 收尾：查看结果
node src/cli.js status
```

或者用 Claude Code：

```
你：今天帮我提交 5 个免费站，从上次没提交过的开始
Claude：好的，让我查看提交记录... 找到 5 个新站点，开始提交...
```

---

**GitHub:** [github.com/s87343472/backlink-pilot](https://github.com/s87343472/backlink-pilot)
