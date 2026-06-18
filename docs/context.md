# 项目上下文 — Backlink Pilot

跨工具上下文单一真相源（Claude Code / Codex / Cursor / …）。
`## Now` 与 `## Next` 各保持 ≤3 行。完整 agent 指令见
[AGENT_GUIDE.md](AGENT_GUIDE.md)；更早的决策见 [adr/](adr/) 与 [plans/](plans/)。

## Now

- nofollow 绕过实测已收口（11 站：机制成立但全卡审核/spam → 外链 0，结论固化进 [research/2026-06-12-nofollow绕过实测.md](research/2026-06-12-nofollow绕过实测.md)）；其衍生的博客评论自动化 **comment-snowball 已独立成平级仓库 `../comment-snowball/` 自行推进，不再属于本仓范围**，本仓只保留半自动 `batch-blog-comments.js` 作其发布出口（[plans/](plans/) 下 comment-snowball plan 仅为历史立项记录）。
- launch 平台 19 站已注册；**TinyLaunch 已发 happyhorse(17764)+addfamilyphoto(17765)（DR72+ dofollow）**，方法+坑固化进 [research 笔记 2026-06-18 条](research/2026-06-04-launch平台半自动接手笔记.md)，脚本 `scripts/submit-tinylaunch.js`；addfamilyphoto 已提交 Future Tools。
- 双产品 config 已落地可一键切换：`config.happyhorse.yaml`（ai-happyhorse.org）/ `config.addfamilyphoto.yaml`（addfamilyphoto.com），密钥只走 gitignore 的 config.yaml/.env；历史 submission 记录已由 scripts/backfill-product.js 盖产品身份。

## Next

- **推开其余免费 dofollow launch 站**（Tiny Startups / Neeed / IndexOf.ai / ToolFame 优先）：交接给另一个 AI 执行，按 [plans/2026-06-18-其余launch站推开交接.md](plans/2026-06-18-其余launch站推开交接.md) 逐站 scout→判定→发→留档（TinyLaunch 方法+脚本为模板）。
- addfamilyphoto.com：联系 Family Tree Magazine / ScanMyPhotos 博客编辑 pitch 收录；考虑付费提交 Toolify.ai（$99，6 条 dofollow）。
