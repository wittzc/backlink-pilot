# scripts/

Maintenance and one-off scripts for backlink-pilot.

| Script | Purpose |
|--------|---------|
| `classify-niche.js` | Rule-map site groups to a `niche` in `targets.yaml` (AI/awesome/community); general pool tagged `_unclassified` for agent sub-classification |
| `update-readme-stats.js` | Refresh `<!-- stats -->` placeholders in README/docs |
| `recipe-smoke-test.js` / `paperform-smoke-test.js` | Manual smoke tests for recipe / provider adapters |

## niche 分类

### 1. 规则映射（0 模型成本）

```bash
node scripts/classify-niche.js          # dry-run，只统计不写
node scripts/classify-niche.js --apply  # 写回 targets.yaml
```

AI 导航 / awesome-list / 社区站直接按分组映射（ai-tools / devtools / community）；
general 池标 `_unclassified`，留给下一步 agent 细分。脚本绝不覆盖已存在的 `niche`。

### 2. general 池细分（agent + 初级模型）

`classify-niche.js` 跑完后，让 agent（初级模型即可，如 haiku）逐站细分。把下面这段
交给 agent 执行：

> 读取 `targets.yaml` 中所有 `niche: _unclassified` 的站点。对每一个，依据
> name + notes + submit_url（必要时打开页面看它收录什么类型的产品），从
> {saas, devtools, startup, design, general} 选一个最贴合的 niche 写回去。
> 判据：
> - `saas`：主要收录商业 SaaS / 工具产品，强调功能与定价
> - `devtools`：主要面向开发者（API、库、CLI、开源工具目录）
> - `startup`：主要收录新产品 / 创业项目 / indie maker 发布
> - `design`：主要收录设计资源 / 灵感 / 创意作品
> - `general`：综合目录，什么都收，无明显偏向
> 拿不准就填 `general`。改完用 `grep -c "_unclassified" targets.yaml` 确认归零。

细分完成后，niche 即可驱动每站差异化文案生成——见
[`../docs/AGENT_GUIDE.md`](../docs/AGENT_GUIDE.md) 的「Niche-driven Content」段。
