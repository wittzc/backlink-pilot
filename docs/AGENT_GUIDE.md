# Backlink Pilot v2.2 — Agent Guide

**关联方案**: docs/plans/2026-04-28-跨agent通用化协议.md

> **This is the single source of truth for AI-agent instructions in this repo.**
> Tool-specific entry files (`CLAUDE.md` / `AGENTS.md` / `.cursorrules` /
> `.github/copilot-instructions.md`) are stubs that redirect here. Edit only
> this file; new agent tools just need a new stub pointing to this file.
>
> **Returning session?** Read [`docs/context.md`](context.md) first — it is the
> cross-tool context SoT (current state in `## Now`, next action in `## Next`).
> Older decision rationale lives in `docs/adr/` and `docs/plans/`.

You are operating **backlink-pilot v2.2**, an automated backlink submission toolkit.
Your job: help users submit their product to directory sites with minimal effort.

A machine-readable summary of commands, options, and exit codes lives at
[`agent-manifest.json`](../agent-manifest.json) — read it before doing anything
ambitious if you want to skip parsing this whole guide.

## Exit Code Convention

All `node src/cli.js <command>` invocations follow this contract:

| Code | Meaning | Agent action |
|------|---------|--------------|
| 0 | success (or graceful no-op) | continue |
| 1 | user-actionable failure (bad config, missing adapter, target not found, page 404, login required, etc.) | surface to user with the printed `nextSteps[]`, do not auto-retry |

JSON-mode failures (`--json`) always print a structured `{ status, code, error, nextSteps, verdict }` payload to stdout AND exit 1. Parse stdout; don't rely on stderr.



## First-time User Flow

When a user opens this project for the first time, guide them step by step:

### Step 1: Check prerequisites
```bash
node --version        # Need 18+
bb-browser --version  # Need 0.10+, install: npm install -g bb-browser
```

If bb-browser is missing, install it:
```bash
npm install -g bb-browser
```

### Step 2: Create config.yaml
Ask the user these questions (and ONLY these — keep it simple):
1. Product name? (e.g. "Metric Converter")
2. Product URL? (e.g. "https://metric-converter.net")
3. One-line description? (under 160 chars)
4. Longer description? (2-3 sentences about features and audience)
5. Contact email?

Then generate `config.yaml` from `config.example.yaml` with their answers. Set `browser.engine: bb`.

### Step 3: Start Chrome
```bash
bb-browser open about:blank
```
If this times out or errors, guide user to:
```bash
# Kill any stuck Chrome
pkill -f "bb-browser" || true
# Retry
bb-browser open about:blank
```

### Step 4: Submit
Start with ONE site to verify everything works:
```bash
node src/cli.js submit futuretools --engine bb
```

## Available Commands

All commands are subcommands of `node src/cli.js`. Run `node src/cli.js --help`
for live syntax; the authoritative machine-readable list is
[`agent-manifest.json`](../agent-manifest.json).

**Submission**

| Command | What it does |
|---------|-------------|
| `submit <site\|url>` | Submit current product to one site. Known adapter name (e.g. `futuretools`) or a URL (generic adapter). `--json` for agent use, `--dry-run`, `--no-auto-verdict` to skip writing failure verdicts. |
| `batch-submit` | Run submission across many targets with dedup + verdict self-correction. `--dry-run` / `--yes`, `--limit N` (real runs default 5), `--category`, `--priority high\|medium\|low`, `--value-tier 1\|2\|3`, `--force site[:reason]`, `--triage-source FILE`. |
| `awesome <repo>` | Generate a GitHub Issue body for an awesome-list submission. `--open` opens the issue page. |
| `indexnow <url>` | Ping Bing/Yandex about a new/updated page. `--key`. |

> **Blog comment submission** is a separate script, not a `cli.js` subcommand:
> `node src/batch-blog-comments.js --limit N` (5-persona rotation, natural-comment
> templates, 15–45s jitter, dual-track dedup). Its history shows up in `status`.

**Discovery & triage**

| Command | What it does |
|---------|-------------|
| `scout <url>` | Diagnose one site's submit page — find fields + submit buttons. `--deep` follows links, `--screenshot PATH`. |
| `triage` | Classify `auto:yes` targets into buckets before batch (generic-ready / adapter-needed / iframe-provider / manual-review). `--browser` for full snapshots, `--limit`, `--category`, `--json`, `--output FILE`. |
| `prune-dead` | Probe target URLs and mark unreachable ones `status: dead`. Dry-run by default; `--apply` writes, `--json`. |

**Verdict layer (self-correction)**

| Command | What it does |
|---------|-------------|
| `locked` | List sites the verdict layer auto-blocked, grouped by code. `--code CODE` drills in, `--json`. |
| `unlock <site> --yes` | Reverse a verdict lock (restore `auto:yes`, drop `auto_blocked_reason`) after you fix the cause. |
| `mark-dead <site> --yes` | Mark a site `status: dead`. |
| `mark-manual <site> --yes` | Mark a site `auto: manual`. |
| `mark-done <site>` | Manually record a successful submission in `submissions.yaml`. |

**Status & maintenance**

| Command | What it does |
|---------|-------------|
| `status` | Show submission tracking (directory + blog comments). `--json`. |
| `stats` | Aggregated submission statistics. `--timing` for p50/p95, `--json`. |
| `doctor` | Check environment health (Node, bb-browser, Chrome, config). Run first if anything misbehaves. |
| `bb-update` | Update bb-browser community site adapters. |
| `cleanup` | Delete old screenshots (`--keep-days N`, default 30) or stale lock files (`--locks`). |

## Site Adapters

Three layers, cheapest first:

1. **Generic** (`src/sites/generic.js`) — universal form-filler for simple,
   visible HTML forms. Used automatically for any URL without a dedicated adapter.
2. **Recipe** (`src/sites/form-recipe.js` + `recipe-loader.js`, declarative YAML
   in `recipes/*.yaml`) — for stable mid-complexity forms. No JS needed to add one.
   Iframe providers (Tally/Typeform/Paperform/Airtable) handled via `src/sites/providers/`.
3. **Site-specific JS** (`src/sites/`) — hand-written for high-value or unusual
   sites: `saashub`, `uneed`, `baitools`, `startup88`, `futuretools`, `aivalley`.

Deprecated adapters `600tools`, `toolverto`, `submitaitools`, `dangai` were
removed in v2.2 (recoverable from git history; they are **not** in the working tree).

For any site without a dedicated adapter, use the generic adapter:
```bash
node src/cli.js submit https://some-directory.com/submit --engine bb
```

## Target Sites

`targets.yaml` contains 250+ directory sites with metadata. Filter by:
- `auto: yes` — can be auto-submitted
- `status: dead` — skip these (45+ confirmed dead)
- `status: paid` — costs money
- `type: form` — has a submission form
- `type: github` — awesome-list (submit via GitHub Issue)

## Key Rules

1. **Never submit the same product to the same site twice** — check `node src/cli.js status` first
2. **Pace submissions**: 1-3 minutes between sites, max 5-10 per session
3. **Always use `--engine bb`** — playwright was removed in v2.2; bb is the only engine
4. **Pre-flight check**: if a site returns 404/500, don't launch browser — check root domain for new submit URL
5. **React forms**: bb-browser's `evalClickReal()` handles React/Vue components that ignore `.click()`
6. **Cloudflare Turnstile**: fill forms FAST — tokens expire in ~2 minutes
7. **Screenshots**: saved to `./screenshots/` for manual verification

## Verdict Layer (self-correcting target pool)

v2.2's core feature: failed submissions auto-write a **verdict** back to
`targets.yaml` so the `auto:yes` pool converges over time without manual upkeep.
On failure, the adapter throws a `code`; `submit` maps it through a verdict table:

| Code | Meaning | Effect on targets.yaml |
|------|---------|------------------------|
| `PAGE_404` | Submit URL 404s | `status: dead`, `auto: no` (immediate) |
| `PAID_WALL` | Paywalled / submissions closed | `status: paid`, `auto: no` (immediate) |
| `LOGIN_REQUIRED` | Redirects to login | `auto: manual` (immediate) |
| `IFRAME_FORM` | Form is a Typeform/Tally/Airtable iframe | `auto: no` (immediate) |
| `NO_FIELDS` | No recognizable fields after long-wait scan | `auto: no` after **2 consecutive** failures |
| `UNKNOWN_ERROR` | Unclassified failure | `auto: no` after **2 consecutive** failures |
| `SERVER_ERROR` / `CHROME_TIMEOUT` / `CAPTCHA_FAILED` | Transient | no targets.yaml change |

Each block stamps `auto_blocked_reason`. Inspect and reverse:

- `node src/cli.js locked` — see what's blocked, grouped by code
- `node src/cli.js locked --code NO_FIELDS` — drill into one bucket
- `node src/cli.js unlock <site> --yes` — restore `auto:yes` after fixing the cause
  (new adapter, updated `submit_url`); the next batch run retries it

Pass `--no-auto-verdict` to `submit` to disable write-back for a one-off run.

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| "bb-browser cannot connect to Chrome" | Chrome not running | `bb-browser open about:blank` |
| "Chrome may be unresponsive" | Stuck Chrome process | Kill Chrome, restart: `bb-browser open about:blank` |
| "404 — submit page gone" | Site changed URL | Visit root domain, find new submit page |
| "Page redirected to login" | Site now requires account | Mark as manual, skip |
| "No recognizable form fields" | Generic adapter can't parse | Run `scout <url> --deep` first |

## When User Says...

| User says | You do |
|-----------|--------|
| "帮我提交外链" / "submit backlinks" | Check config.yaml exists → ask what sites → run submit |
| "提交到所有免费站" / "submit to all free sites" | Filter targets.yaml for `auto: yes`, exclude `status: dead/paid`, submit one by one with pacing |
| "这个站能提交吗" / "can I submit to this site?" | Run `scout <url> --deep` to check |
| "提交情况" / "status" | Run `node src/cli.js status` |
| "外链策略" / "backlink strategy" | Read Strategy section in README.md, give advice |

## Batch Submission Playbook

When the user asks to submit to multiple sites ("提交到所有免费站" / "批量提交" / "submit to all free sites"):

**Preferred path — `batch-submit`** (built-in dedup + verdict write-back + pacing):

1. `node src/cli.js doctor` — confirm Node / bb-browser / Chrome / config are healthy
2. `node src/cli.js triage --json --output reports/triage.json` — classify the pool first
   (skip if a recent triage report already exists)
3. Dry-run before committing: `node src/cli.js batch-submit --dry-run --limit 10`
4. Real run: `node src/cli.js batch-submit --yes --limit 5`
   (real runs default to 5; `--yes` is required without `--dry-run`)
5. The executor automatically skips already-submitted `(site, productHash)` pairs and
   writes verdicts for failures — no manual `mark-dead` / `mark-manual` needed
6. After the run: `node src/cli.js stats` for the summary, `node src/cli.js locked`
   to see what the verdict layer blocked this round

**Manual path — one site at a time** (for debugging or fine control):

1. `node src/cli.js status` — see what's already submitted, avoid duplicates
2. `node src/cli.js submit <name> --engine bb --json` — submit one site
3. Wait 60–180 seconds (random) between sites
4. Read the returned `nextSteps[]` and act:
   - `PAGE_404` / `LOGIN_REQUIRED` / `IFRAME_FORM` → verdict layer already handled it; continue
   - `CHROME_TIMEOUT` → `pkill -f "bb-browser" || true && bb-browser open about:blank`, retry once
   - `submitted` → continue to next site
5. Print summary — submitted X / failed Y / skipped Z

Default limit: 5–10 sites per session (user can override: "帮我提交 5 个").

## Niche-driven Content (per-site copy)

Each target in `targets.yaml` carries a `niche` (and `lang`). Instead of submitting
one fixed description everywhere, generate copy that fits the site — this lifts
acceptance rate and avoids the spam signal of identical text.

For each site in a batch:
1. Read the target's `niche` and `lang` from `targets.yaml`.
2. Generate a description from `config.product` info, following the niche guide below.
   Write it in `lang` (en/zh; for `multi`, use English). Keep it within the recommended length.
3. Write the text to a temp file and submit:
   `node src/cli.js submit <site> --description-file /tmp/copy-<site>.txt --engine bb`
4. If `niche` is missing, treat it as `general`.

Niche guide:

| niche | Emphasize | Tone | Length |
|-------|-----------|------|--------|
| `ai-tools` | what AI capability solves which concrete task | direct value | tagline + one paragraph |
| `saas` | positioning, target customer, business problem, pricing | formal, structured | one paragraph |
| `devtools` | tech stack, developer-facing, API/integration/workflow | technical, specific | one line for awesome-lists, else a paragraph |
| `startup` | new product, indie-made, the pain it solves, novelty | narrative, indie story | one paragraph |
| `community` | genuine sharing voice, give value, no hard sell | casual, restrained | short, conversational |
| `general` | a crisp one-line positioning + core features | neutral, information-dense | one paragraph |
| `design` | the visual/creative/inspiration angle | visual-leaning | one paragraph |

Pure-CLI users (no agent) can skip this — `submit` without `--description-file`
falls back to `config.product`, unchanged behavior.

## Config Reference

```yaml
product:
  name: "Product Name"
  url: "https://product.com"
  description: "One-line description"
  long_description: "Detailed description..."
  email: "hello@product.com"
  categories: [developer-tools]
  pricing: free  # free | freemium | paid

browser:
  engine: bb            # always use bb
  timeout: 30000

utm:
  enabled: true         # false to disable tracking params
  base_url: "https://product.com"
```

## File Layout

```
config.yaml              ← User's product config (gitignored)
config.example.yaml      ← Template
targets.yaml             ← ~258 target sites with auto/status/auto_blocked_reason
submissions.yaml         ← Submission history; each record carries `product` (name) +
                            `productHash`, so the file stays filterable by product even
                            though it is shared across configs (gitignored)
recipes/*.yaml           ← Declarative form recipes (no JS adapter needed)
reports/                 ← triage JSON + run logs
docs/context.md          ← Cross-tool context SoT (Now / Next)
docs/AGENT_GUIDE.md      ← This file — single source of truth for agents
docs/adr/                ← Architecture decision records
docs/plans/              ← Plan documents (see plans/README.md)
src/cli.js               ← CLI entry point (all subcommands)
src/submit.js            ← Submission dispatcher + pre-flight + verdict write-back
src/triage.js            ← Pre-batch target classification
src/batch-submit.js      ← Batch executor (dedup + pacing)
src/bb.js                ← bb-browser wrapper (BbPage API)
src/targets.js           ← targets.yaml read/write (mark-dead/manual, lock/unlock)
src/sites/generic.js     ← Universal form-filling adapter
src/sites/form-recipe.js ← Recipe-driven adapter + recipe-loader.js
src/sites/providers/     ← Iframe form providers (Tally/Typeform/Airtable/…)
src/sites/*.js           ← Site-specific adapters
```
