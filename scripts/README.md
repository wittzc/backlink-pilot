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

`classify-niche.js` 跑完后，`_unclassified` 池里只有 `auto: yes` 的站值得细分——
`auto: no/manual`、`dead/paid` 的站不会被提交，跳过。

让 agent（初级模型即可，如 haiku）分类，**返回 JSON 映射、不要直接改文件**：所有
`niche: _unclassified` 行内容相同，逐行 Edit 无法唯一定位，写回交给脚本做。交给 agent：

> 读取 `targets.yaml`，找出所有 `niche: _unclassified` 且 `auto: yes` 的站点。
> 对每一个，依据 name + notes + submit_url，从 {saas, devtools, startup, design,
> general} 选一个最贴合的 niche。判据：
> - `saas`：商业 SaaS / 软件工具，强调功能与定价
> - `devtools`：面向开发者（API、库、CLI、开源工具目录）
> - `startup`：新产品 / 创业项目 / indie maker 发布
> - `design`：设计资源 / 灵感 / 创意作品
> - `general`：综合目录，无明显偏向
> 拿不准填 `general`。只返回 JSON 数组：`[{"name":"站名","niche":"general"}, ...]`

把 agent 返回的 JSON 存成文件，用脚本写回（只写 `auto: yes` 的 `_unclassified` 站，
非法 niche 值会报错）：

```bash
node scripts/classify-niche.js --apply-map /path/to/niche-map.json
```

写回后用下面确认 `auto: yes` 的 `_unclassified` 已归零（剩下的是 no/manual 的不提交站）：

```bash
awk '/^  - name:/{if(a=="yes"&&n=="_unclassified")print nm;nm=$0;a="?";n=""}
     /^    auto:/{a=$2}/^    niche:/{n=$2}' targets.yaml
```

细分完成后，niche 即可驱动每站差异化文案生成——见
[`../docs/AGENT_GUIDE.md`](../docs/AGENT_GUIDE.md) 的「Niche-driven Content」段。
