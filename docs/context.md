# 项目上下文 — Backlink Pilot

跨工具上下文单一真相源（Claude Code / Codex / Cursor / …）。
`## Now` 与 `## Next` 各保持 ≤3 行。完整 agent 指令见
[AGENT_GUIDE.md](AGENT_GUIDE.md)；更早的决策见 [adr/](adr/) 与 [plans/](plans/)。

## Now

- nofollow 绕过实测完成并收口（11 站：机制成立、评论入库、全卡审核/spam 未公开 → 外链 0）；一次性探针脚本+报告已删，结论固化进 [research/2026-06-12-nofollow绕过实测.md](research/2026-06-12-nofollow绕过实测.md)。建议暂不纳入（未拍板）。
- launch 平台 19 站已注册（TinyLaunch Startups 未解锁）；addfamilyphoto 已提交 Future Tools。
- 双产品 config 已落地可一键切换：`config.happyhorse.yaml`（ai-happyhorse.org）/ `config.addfamilyphoto.yaml`（addfamilyphoto.com），密钥只走 gitignore 的 config.yaml/.env；历史 submission 记录已由 scripts/backfill-product.js 盖产品身份。

## Next

- comment-snowball **Phase 0 三假设全过**（真实数据：软审核博客评论可公开+不限 niche / 滚雪球有燃料 / Ahrefs 数据走 XHR 可拦但 Turnstile→半自动），项目 ROI 成立（见 [plans/2026-06-12-comment-snowball立项与发现slice.md](plans/2026-06-12-comment-snowball立项与发现slice.md)）。下一步 **Slice 1**：建独立仓库 + 发现链路。目标站筛选=「被多游戏站反复刷过的软审核博客」。
- TinyLaunch：补全/修正 Maker Profile（疑似 X/Twitter handle 必填或 handle 冲突）并保存，解锁 Startups 后验证提交表单结构 → 标准则写 recipe。
- addfamilyphoto.com：联系 Family Tree Magazine / ScanMyPhotos 博客编辑 pitch 收录；考虑付费提交 Toolify.ai（$99，6 条 dofollow）。
