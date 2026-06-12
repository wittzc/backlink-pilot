# comment-snowball 立项 + 发现 slice

> 博客评论外链自动化:Chrome 插件 + Google Sheet 流水线。从种子站滚雪球发现「能发评论的博客文章」,产出可直接喂给发布通道的文章库。
>
> 衍生自 backlink-pilot 的 [nofollow 绕过实测](../research/2026-06-12-nofollow绕过实测.md) + [方法论全景 §4/§6](../research/外链建设方法论全景.md)(哥飞帖 29)。本 plan 是新项目 comment-snowball 的立项 + 第一个 slice,暂存在 backlink-pilot/docs/plans,建独立仓库后迁移。

## 已定决策(不再讨论)

- **抓窗口期**:nofollow 绕过 / Ahrefs 拦截都属「依赖第三方不改」的窗口期手法,我们就是要抓这个窗口期。窗口期风险是接受的前提,不是反对理由。
- **独立新仓库**:comment-snowball 与 backlink-pilot 平级,各自独立,通过 Google Sheet 共享数据。不塞进 backlink-pilot(避免污染其合规定位)。
- **先做发现**:本 slice 只做「发现 + 接现成发布出口」,不做全自动发布。
- **赛道**:主力服务不卷赛道/站群(小游戏站、工具站),顺带给卷赛道 AI SaaS 撑外链域名数。

## Goal

产出一个能滚雪球发现「可发布博客文章库」的 Chrome 插件 + Sheet 后端,发现结果能直接导出成 backlink-pilot `batch-blog-comments.js` 吃得下的格式,**立刻闭环**(半自动发布复用现成脚本,不重造)。

success criteria(可验证的终态):
- 给一个种子站,插件能拦 Ahrefs 拿到它的外链、判定哪些是博客文章、抓评论、从评论链接发现新同类站,全程写进 Sheet;
- 跑一轮滚雪球能从 N 个种子滚出 ≥10× 的「可发布博客文章」候选;
- 导出的文章库能被 `batch-blog-comments.js` 直接消费,发出去 ≥1 条评论验证闭环通。

---

## Phase 0:窗口期前的侦察(1-2 天,零插件代码)

> 抓窗口期要快,但 3-5 周投入前先确认链路三个命脉假设成立,避免打水漂。这不是犹豫——是让窗口期投入更准。三项全过 → 进 Slice 1;任一不过 → 当场调策略,省下数周。
>
> 做法:手动 + 浏览器 + backlink-pilot 现有 bb-browser,不写插件代码。

### P0-1 不卷赛道评论的「可公开性」(最关键,直接证伪整个 ROI)

我们实测过的是**卷赛道成熟站(全卡审核/spam)**;不卷赛道审核松是哥飞的论断,**没自己验证过**。这条是整个项目的赌注,必须先验。

- 拿哥飞给的 3 个真站(basketball-stars.io / ageofwargame.io / pips-game.com)+ 用 AITDK 查近年注册的小游戏站再凑几个。
- 对每个站跑 Ahrefs free backlink checker,挑出指向博客文章的外链。
- **手动打开这些博客文章,看评论区**:是不是真有大量带链接评论公开着、时间跨度长(十几年)?
- **通过标准**:找到 ≥5 个「评论区公开着大量带链接评论」的活跃博客文章 → 证明这类站评论确实公开有效、审核松。

### P0-2 Ahrefs free 取数现状(发现链路第一环,可能已失效)

plan 里的端点名 `stGetFreeBacklinksList` 是 2025 老帖搬的,Ahrefs 这两年大幅收紧免费工具,必须验当前状态。

- 实际打开 ahrefs.com/backlink-checker,输一个域名,开 DevTools Network。
- 看:要不要登录?有没有验证码?返回多少条外链?**数据走的是 XHR/fetch 还是 SSR 进 HTML**(决定 content script 能不能拦)?当前端点名是什么?
- **通过标准**:能拿到 ≥几十条外链 + 确认数据走可拦截的 XHR/fetch。若 SSR/要登录/强验证码 → 换数据源(Semrush free / 自建 + 其他 backlink API)再评估。

### P0-3 滚雪球燃料(发现机制能不能自我延续)

滚雪球假设「博客评论里的链接指向更多同行站」。小游戏圈扎堆同一批博客时成立,要验。

- 从 P0-1 找到的博客评论里,提取评论者的出站链接。
- 看这些链接是不是指向更多同类小游戏站/工具站。
- **通过标准**:能从一个博客的评论里发现 ≥3 个新的同类站 → 滚雪球有燃料、能自我延续。

> **Phase 0 产出**:一份侦察结论(三项通过与否 + 实际数据)写进 comment-snowball 的 docs/context.md。这同时是第一批真实种子站 + 真实可发布文章,直接喂给 Slice 1。

### Phase 0 实测发现(2026-06-12,已跑 P0-2)

**P0-2(Ahrefs 取数)已实测,结论决定性:**
- ✅ Ahrefs free 数据走 `https://ahrefs.com/v4/stGet*` 的 XHR(与帖 19 的 `stGetFreeBacklinksList` 命名一致)→ **数据可拦截**,插件拦 XHR 方案技术成立。
- ❌ 查询受 **Cloudflare Turnstile** 保护,**headless / Playwright 自动化过不了**(实测点击查询后卡在 Turnstile challenge,无数据返回)。
- **双面含义**:
  - (好)这是**必须用浏览器插件而非 headless 的硬证据**——真实浏览器(用户日常已被 Cloudflare 信任)能过 Turnstile,插件拦那个已验证的 XHR 响应。哥飞的架构选择被实证。
  - (约束)**全自动滚雪球会撞 Turnstile + 速率限制**:连续查几百个种子站,Turnstile 会拦。滚雪球的「自动」程度受限。

**对 Slice 1 的修正:**
- **S1-3 拦截**:明确是「用户在真实浏览器手动/批量触发查询 → 插件拦 XHR」,不是后台无人值守自动查。
- **S1-5 滚雪球**:从「全自动」降级为「**用户辅助的半自动**」——用户逐批触发查询过 Turnstile,插件拦截积累进 Sheet,不是纯后台自动滚。这是 Turnstile 的硬约束,不是设计选择。

**P0-1 / P0-3 待验**(评论可公开性 + 滚雪球燃料):需先拿到小游戏站的外链列表→博客文章,而匿名取数卡在 Turnstile。两条路:(a) 用用户的 Ahrefs 登录态手动取数;(b) 换不受 Turnstile 的免费 backlink 数据源(Semrush free / 自建爬虫 / 其他)。

---

## Slice 1:发现 slice(建仓库 + 发现链路 + 接现成发布出口)

> 每个 task 可独立验证。MV3 的 service worker 生命周期是硬约束,架构按它设计。

### S1-1 建独立仓库骨架
- 新目录 `comment-snowball/` 平级于 backlink-pilot + `git init`。
- 项目 CLAUDE.md(redirect 到 docs/AGENT_GUIDE,同 backlink-pilot 模式)+ docs/context.md(Now/Next)。
- MV3 `manifest.json` 骨架:permissions(`webRequest`/`storage`/`identity`/`alarms`/host_permissions)、content script、background service worker、popup。
- 验证:`chrome://extensions` 加载无报错,popup 能开。

### S1-2 数据底座:Google Sheet + OAuth
- 设计 Sheet schema:`seeds`(种子站)/`articles`(发现的博客文章:url·platform·comment_structure·status)/`posts`(发布记录:站·文章·anchor·rel·收录)/`copy`(产品文案)。
- `chrome.identity.getAuthToken` 接 Google Sheets API。
- **明确处理 extension ID 固定问题**:plan 文档写清「开发模式下固定 key + Cloud Console 配 extension ID」的具体步骤(这步对非开发者最易卡)。
- 验证:插件能读写一张测试 Sheet。

### S1-3 拦截 Ahrefs 外链
- content script 在 ahrefs.com/backlink-checker 页 hook fetch/XHR(端点名以 P0-2 实测为准),捕获外链响应 JSON。
- 解析出外链域名/URL 列表 → 写 Sheet `articles` 候选。
- 验证:打开一个域名的 checker 页,Sheet 里出现该域名的外链列表。

### S1-4 判定博客文章 + 抓评论
- 对每条外链 URL,判定是否博客文章(有评论区结构:`#commentform`/`.comment-list` 等,先只认标准 WP)。
- 抓评论列表 + 提取每条评论的出站链接(滚雪球燃料)。
- 验证:给一个已知博客文章 URL,能正确识别为可发布 + 抓出评论里的出站链接。

### S1-5 滚雪球编排(按 MV3 生命周期设计)
- **不在 service worker 跑长任务**(空闲 30s 被杀)。状态机:待处理队列存 Sheet/`chrome.storage`,`chrome.alarms` 周期唤醒,每次只处理一个站/一篇文章,处理完更新状态。
- 流程:种子站 → 拦外链 → 判文章 → 抓评论 → 评论里的新站入队 → 循环。
- 去重(站 + 文章已处理跳过)。
- 验证:给 3 个种子站,跑一轮能滚出 ≥10× 的候选文章,中途关闭浏览器再开能续跑(状态持久)。

### S1-6 发布出口:接 backlink-pilot 现成脚本
- 把 Sheet `articles` 里「可发布 + 标准 WP」的文章,导出成 backlink-pilot `resources/backlink-resources.json` 的 schema(type/url/has_url_field/has_captcha…)。
- 验证:导出文件能被 `node src/batch-blog-comments.js` 直接消费,半自动发出 ≥1 条评论 → **闭环打通**。

---

## 不在本 slice(明确划界)

- **全自动发布**:本 slice 发布复用 backlink-pilot 现成 `batch-blog-comments.js`(半自动)。全自动发布(插件真人操作 + rel 验证 + 节奏)是 Slice 2。
- **完整 popup UI**:本 slice 只要最小 UI(看进度 + 配种子)。
- **多平台评论适配**:只覆盖标准 WP 评论。Squarespace/Disqus/JS 评论降级为「插件辅助手动」,不在本 slice 自动化(实测教训:多站适配是无底洞)。

## 自检修正落实对照

| 自检发现 | 本 plan 怎么改的 |
|---|---|
| 缺前置假设验证,违反「先探针后投入」 | 加 Phase 0(三项命脉假设,1-2 天零代码) |
| Ahrefs 端点名从老帖搬、可能失效 | P0-2 实测当前取数现状,端点以实测为准 |
| MV3 service worker 会杀长任务 | S1-5 用 alarms + storage 状态机,不在 worker 跑长任务 |
| 发现不闭环、没用现成资产 | S1-6 导出成 batch-blog-comments.js 吃的格式,立刻闭环 |
| OAuth 配置摩擦轻描淡写 | S1-2 明确 extension ID 固定步骤要文档化 |
| task 颗粒度太粗 | Slice 1 拆成 6 个可独立验证的 task |
