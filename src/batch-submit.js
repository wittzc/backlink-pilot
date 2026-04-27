#!/usr/bin/env node

// batch-submit.js — Directory batch executor (v2.3, Task 5).
//
// Consumes a triage report (or runs triage live) and dispatches each
// non-skipped target to the right adapter family:
//
//   generic-ready          → src/sites/generic.js
//   recipe-ready           → src/sites/<siteKey>.js (recipes/<siteKey>.yaml inside)
//   provider-ready         → src/sites/providers/<provider>.js
//   custom-adapter-needed  → src/sites/<siteKey>.js (hand-written)
//   manual-review / dead   → recorded as skipped, never executed.
//
// Safety story for production:
//   1. The executor itself NEVER auto-runs. User must invoke
//      `backlink-pilot batch-submit` (without --dry-run) to do real submits.
//   2. Default adapter call uses `dryRun: true`. Dropping --dry-run flips it.
//   3. Recommend small --limit first run. --force is opt-in per-site only;
//      `--force all` is rejected.
//   4. Dedup gate (status=submitted only) prevents accidental re-submission
//      of the same product to the same site. --force <site> overrides per
//      site with an explicit reason.
//
// Test invariant: this module never opens a real browser unless the caller
// supplies non-mock dependencies. All adapter / sleep / IO is injectable
// via the `_deps` parameter so unit tests can verify dispatch + dedup +
// rate-limit-mock without touching the network.

import { readFileSync, existsSync } from 'fs';
import { siteKeyFromName } from './site-key.js';
import { productHash, loadSubmissionMap, recordResult } from './tracker.js';
import { triageTargets } from './triage.js';
import { loadConfig } from './config.js';

// Adapter modules — imported lazily inside the default dispatcher so unit
// tests that inject a stub dispatcher never load the real adapters (and
// therefore never accidentally pull in browser code).

const DEFAULT_SUBMISSIONS_PATH = 'submissions.yaml';
const RATE_LIMIT_MIN_MS = 60_000;
const RATE_LIMIT_MAX_MS = 180_000;

// ---------------------------------------------------------------------------
// --force flag parser
//
// Accepts a comma-separated list of `siteKey[:reason]` tokens.
// Examples:
//   "futuretools"                          → { futuretools: 'manual-override' }
//   "futuretools:rebrand"                  → { futuretools: 'rebrand' }
//   "futuretools,aivalley:test-rerun"      → { futuretools: 'manual-override',
//                                              aivalley: 'test-rerun' }
//   "all"                                  → throws — explicit by-site only.
//
// Returns Map<siteKey, reason>. Empty input → empty map.
// ---------------------------------------------------------------------------

export function parseForceFlag(raw) {
  const map = new Map();
  if (!raw || typeof raw !== 'string') return map;
  const tokens = raw.split(',').map((t) => t.trim()).filter(Boolean);
  for (const token of tokens) {
    if (token.toLowerCase() === 'all') {
      throw new Error(
        '--force all is not supported. List specific siteKeys (comma-separated), e.g. ' +
        '--force futuretools,aivalley:rebrand'
      );
    }
    const [siteKey, ...reasonParts] = token.split(':');
    const reason = reasonParts.length ? reasonParts.join(':').trim() : 'manual-override';
    if (!siteKey) continue;
    map.set(siteKey.trim(), reason || 'manual-override');
  }
  return map;
}

// ---------------------------------------------------------------------------
// Bucket → adapterType normalisation. The triage report uses bucket names
// directly; the batch executor flattens these into one of:
//   generic | recipe | provider | site-specific | skipped
// ---------------------------------------------------------------------------

export function adapterTypeForBucket(bucket) {
  switch (bucket) {
    case 'generic-ready':
      return 'generic';
    case 'recipe-ready':
      return 'recipe';
    case 'provider-ready':
      return 'provider';
    case 'custom-adapter-needed':
      return 'site-specific';
    case 'manual-review':
    case 'dead':
    default:
      return 'skipped';
  }
}

// ---------------------------------------------------------------------------
// Default dispatcher — maps an adapterType + triage entry to a callable.
// Returns `null` for skipped/unknown adapter types so the executor can
// short-circuit cleanly. Each adapter is loaded lazily via dynamic import.
//
// Adapter signature contract (inputs may vary per adapter, but every
// adapter accepts `{ dryRun }` and returns a result object that the
// executor coerces into the standard record schema):
//
//   await adapter.submit(product, { ...config, dryRun, page?, url? })
//
// Tests inject a stub dispatcher that returns deterministic results without
// loading real adapter code.
// ---------------------------------------------------------------------------

export async function defaultDispatcher(target, { product, dryRun, config }) {
  const adapterType = target.adapterType;
  if (adapterType === 'skipped') return null;

  if (adapterType === 'generic') {
    const mod = await import('./sites/generic.js');
    const submit = mod.submit || mod.default?.submit || mod.default;
    if (typeof submit !== 'function') {
      throw new Error('generic adapter: no submit() export found');
    }
    return submit({ ...product, _submitUrl: target.submit_url }, { ...config, dryRun });
  }

  if (adapterType === 'recipe' || adapterType === 'site-specific') {
    // Both buckets resolve to src/sites/<siteKey>.js. Recipe-routed adapters
    // (futuretools, aivalley) internally pick recipe vs legacy. Hand-written
    // adapters (saashub, uneed, baitools, startup88) just expose .submit.
    const siteKey = target.siteKey;
    if (!siteKey) {
      throw new Error(`${adapterType} adapter: missing siteKey for ${target.name}`);
    }
    // Adapter file names are unhyphenated (e.g. "aivalley.js"), but
    // siteKey from triage produces dashed slugs ("ai-valley"). Try the
    // dashed slug first, then fall back to the unhyphenated form, before
    // giving up. The triage and adapter naming conventions are owned by
    // separate modules — this dispatcher reconciles them at runtime
    // rather than forcing one to change to match the other.
    const candidates = [siteKey, siteKey.replace(/-/g, '')];
    let mod = null;
    let lastErr = null;
    for (const candidate of candidates) {
      try {
        mod = await import(`./sites/${candidate}.js`);
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!mod) {
      const e = new Error(
        `adapter not found: tried [${candidates.join(', ')}] in src/sites/ (${lastErr?.message || 'no candidates'})`
      );
      e.code = 'ADAPTER_NOT_FOUND';
      throw e;
    }
    const submit = mod.default?.submit || mod.submit;
    if (typeof submit !== 'function') {
      throw new Error(`${adapterType} adapter: ${siteKey} has no submit() export`);
    }
    return submit(product, { ...config, dryRun });
  }

  if (adapterType === 'provider') {
    const provider = target.provider;
    if (provider === 'paperform') {
      const mod = await import('./sites/providers/paperform.js');
      // Paperform adapter signature: submit(product, { dryRun, url, page })
      // The executor doesn't own a browser session — production callers must
      // supply a `page` via deps. Without one, dry-run returns a stub.
      if (!dryRun) {
        const e = new Error(
          'paperform provider: real submit not yet implemented (Task 4 scope). ' +
          'Re-run with --dry-run.'
        );
        e.code = 'PROVIDER_NOT_IMPLEMENTED';
        throw e;
      }
      return { dryRun: true, provider: 'paperform', url: target.provider_url };
    }
    const e = new Error(`provider adapter not implemented: ${provider}`);
    e.code = 'PROVIDER_ADAPTER_NOT_IMPLEMENTED';
    throw e;
  }

  throw new Error(`unknown adapterType: ${adapterType}`);
}

// ---------------------------------------------------------------------------
// Result-record schema (Task 5 step 1).
// ---------------------------------------------------------------------------

function makeResult({
  targetKey,
  adapterType,
  status,
  code,
  evidence = null,
  productHash: hash,
  forced = false,
  forceReason = null,
  reason = null,
}) {
  return {
    targetKey,
    adapterType,
    status,
    code,
    submittedAt: new Date().toISOString(),
    evidence,
    productHash: hash,
    forced,
    forceReason,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Result interpretation. Adapters return varied shapes; normalise them into
// { status, code, evidence } for the result record.
// ---------------------------------------------------------------------------

function interpretAdapterReturn(value) {
  if (!value || typeof value !== 'object') {
    return { status: 'submitted', code: 'OK', evidence: null };
  }
  if (value.status && value.code) {
    return {
      status: value.status,
      code: value.code,
      evidence: value.evidence || null,
    };
  }
  if (value.dryRun === true) {
    return { status: 'submitted', code: 'DRY_RUN_OK', evidence: value };
  }
  if (value.success === false) {
    return {
      status: 'failed',
      code: value.code || 'ADAPTER_REPORTED_FAILURE',
      evidence: value,
    };
  }
  return { status: 'submitted', code: 'OK', evidence: value.evidence || null };
}

function interpretAdapterError(err) {
  const code = err?.code || classifyError(err?.message || '');
  return { code, message: err?.message || String(err) };
}

function classifyError(msg) {
  const m = String(msg).toLowerCase();
  if (/captcha|turnstile|recaptcha|hcaptcha/.test(m)) return 'CAPTCHA_REQUIRED';
  if (/login|sign[- ]?in|signup|register/.test(m)) return 'LOGIN_REQUIRED';
  if (/timeout|timed out|net::|enet|econnrefused|econnreset|enotfound/.test(m)) return 'NETWORK_ERROR';
  if (/404|not found|page unreachable/.test(m)) return 'PAGE_404';
  if (/chrome.*unrespons|bb[- ]browser/.test(m)) return 'CHROME_TIMEOUT';
  return 'ADAPTER_ERROR';
}

// ---------------------------------------------------------------------------
// Triage source loading.
// ---------------------------------------------------------------------------

export function loadTriageReport(path) {
  if (!existsSync(path)) {
    throw new Error(`triage report not found: ${path}`);
  }
  const data = JSON.parse(readFileSync(path, 'utf-8'));
  if (!data || !Array.isArray(data.results)) {
    throw new Error(`triage report ${path} has no results[]`);
  }
  return data;
}

/**
 * Normalise a triage result entry into the executor's per-target shape.
 * Entries the executor cannot act on (manual-review / dead) still surface so
 * they get recorded as skipped.
 */
export function prepareTargets(triageResults) {
  return triageResults.map((r) => ({
    name: r.name,
    siteKey: siteKeyFromName(r.name),
    submit_url: r.submit_url,
    category: r.category,
    bucket: r.bucket,
    adapterType: adapterTypeForBucket(r.bucket),
    code: r.code,
    reason: r.reason || null,
    provider: r.provider || null,
    provider_url: r.provider_url || null,
    value_tier: r.value_tier || 3,
  }));
}

// ---------------------------------------------------------------------------
// Filtering + ordering (Task 5 step 6).
// ---------------------------------------------------------------------------

export function filterAndSort(targets, opts = {}) {
  let out = targets.slice();
  if (opts.category) out = out.filter((t) => t.category === opts.category);
  if (opts.priority) {
    const map = { high: 1, medium: 2, low: 3 };
    const want = map[String(opts.priority).toLowerCase()];
    if (want) out = out.filter((t) => (t.value_tier || 3) === want);
  }
  if (opts.valueTier) {
    const want = Number(opts.valueTier);
    if (!Number.isNaN(want)) out = out.filter((t) => (t.value_tier || 3) === want);
  }
  // Default: ascending value_tier (tier-1 first).
  out.sort((a, b) => (a.value_tier || 99) - (b.value_tier || 99));
  if (opts.limit) out = out.slice(0, Number(opts.limit));
  return out;
}

// ---------------------------------------------------------------------------
// Sleep — DI for testability.
// ---------------------------------------------------------------------------

export async function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickRateLimitDelay(rng = Math.random) {
  return RATE_LIMIT_MIN_MS + rng() * (RATE_LIMIT_MAX_MS - RATE_LIMIT_MIN_MS);
}

// ---------------------------------------------------------------------------
// Main executor.
//
// opts:
//   product             — product config object (required for productHash)
//   config              — adapter config (passed through to adapters)
//   dryRun              — global dry-run flag (default false)
//   forceMap            — Map<siteKey, reason> from --force
//   submissionsPath     — defaults to submissions.yaml
//   limit/category/...  — see filterAndSort
//
// _deps (test injection):
//   sleepFn             — sleep implementation
//   dispatcher          — async (target, ctx) → adapter return value
//   submissionMap       — pre-built dedup map
//   recordFn            — async (path, result) → void
//   rng                 — Math.random replacement for delay jitter
//   logger              — { info, warn, error } (default console)
// ---------------------------------------------------------------------------

export async function runBatch(targets, opts = {}, _deps = {}) {
  const {
    product,
    config = {},
    dryRun = false,
    forceMap = new Map(),
    submissionsPath = DEFAULT_SUBMISSIONS_PATH,
  } = opts;

  if (!product || !product.name || !product.url) {
    throw new Error('runBatch: opts.product { name, url, email } is required');
  }

  const {
    sleepFn = defaultSleep,
    dispatcher = defaultDispatcher,
    submissionMap = loadSubmissionMap(submissionsPath),
    recordFn = recordResult,
    rng = Math.random,
    logger = console,
  } = _deps;

  const hash = productHash(product);
  const results = [];
  const summary = { submitted: 0, skipped: 0, manual: 0, dead: 0, failed: 0 };

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const targetKey = target.siteKey || target.name;

    // Bucket-driven skip: dead / manual-review never execute.
    if (target.adapterType === 'skipped') {
      const status = target.bucket === 'dead' ? 'dead' : 'manual';
      const result = makeResult({
        targetKey,
        adapterType: 'skipped',
        status,
        code: target.code || (status === 'dead' ? 'PAGE_UNREACHABLE' : 'MANUAL_REVIEW'),
        productHash: hash,
        reason: target.reason || target.bucket,
      });
      results.push(result);
      summary[status] += 1;
      await recordFn(submissionsPath, result);
      logger.info?.(`  [${i + 1}/${targets.length}] ${targetKey} → ${status} (${result.code})`);
      continue;
    }

    // Dedup gate. Only `submitted` short-circuits — `failed` entries are
    // free to retry on the next run.
    const dedupKey = `${targetKey}::${hash}`;
    const lastStatus = submissionMap.get(dedupKey);
    const forced = forceMap.has(targetKey);
    if (lastStatus === 'submitted' && !forced) {
      const result = makeResult({
        targetKey,
        adapterType: target.adapterType,
        status: 'skipped',
        code: 'ALREADY_SUBMITTED',
        productHash: hash,
        reason: 'already-submitted',
      });
      results.push(result);
      summary.skipped += 1;
      await recordFn(submissionsPath, result);
      logger.info?.(`  [${i + 1}/${targets.length}] ${targetKey} → skipped (already submitted)`);
      continue;
    }

    const forceReason = forced ? forceMap.get(targetKey) : null;

    // Execute with a single-shot retry on the first failure (per Task 5
    // step 8 — "same reason code max 1 retry"). Track first reason; if the
    // second attempt fails with the same code, give up.
    let attempt = 0;
    let result = null;
    let lastFailCode = null;
    while (attempt < 2) {
      attempt += 1;
      try {
        const ret = await dispatcher(target, { product, config, dryRun });
        const interp = interpretAdapterReturn(ret);
        result = makeResult({
          targetKey,
          adapterType: target.adapterType,
          status: interp.status,
          code: interp.code,
          evidence: interp.evidence,
          productHash: hash,
          forced,
          forceReason,
        });
        // CAPTCHA from a successful return value is still fail-fast — break
        // and don't retry. Other status:'failed' may retry once.
        if (interp.status === 'failed' && interp.code !== 'CAPTCHA_REQUIRED') {
          if (attempt < 2 && lastFailCode !== interp.code) {
            lastFailCode = interp.code;
            continue;
          }
        }
        break;
      } catch (err) {
        const interp = interpretAdapterError(err);
        // CAPTCHA fail-fast — never retry.
        if (interp.code === 'CAPTCHA_REQUIRED') {
          result = makeResult({
            targetKey,
            adapterType: target.adapterType,
            status: 'failed',
            code: 'CAPTCHA_REQUIRED',
            productHash: hash,
            forced,
            forceReason,
            reason: interp.message,
          });
          break;
        }
        if (attempt < 2 && lastFailCode !== interp.code) {
          lastFailCode = interp.code;
          continue;
        }
        result = makeResult({
          targetKey,
          adapterType: target.adapterType,
          status: 'failed',
          code: interp.code,
          productHash: hash,
          forced,
          forceReason,
          reason: interp.message,
        });
        break;
      }
    }

    results.push(result);
    summary[result.status] = (summary[result.status] || 0) + 1;
    await recordFn(submissionsPath, result);
    const tag = forced ? ` [forced:${forceReason}]` : '';
    logger.info?.(
      `  [${i + 1}/${targets.length}] ${targetKey} → ${result.status} (${result.code})${tag}`
    );

    // Rate-limit between sites (skip after last). Skipped tier-1 dedup hits
    // also got a continue earlier, so this only fires on real executions.
    if (i < targets.length - 1) {
      await sleepFn(pickRateLimitDelay(rng));
    }
  }

  return { results, summary };
}

// ---------------------------------------------------------------------------
// CLI entry point. Used both by `node src/batch-submit.js` and from cli.js's
// `batch-submit` subcommand (which calls runBatchCli directly).
// ---------------------------------------------------------------------------

export async function runBatchCli(opts = {}, _deps = {}) {
  const triageSource = opts.triageSource || null;
  const submissionsPath = opts.submissionsPath || DEFAULT_SUBMISSIONS_PATH;
  const dryRun = !!opts.dryRun;
  const {
    loadConfigFn = loadConfig,
    triageFn = triageTargets,
    runBatchFn = runBatch,
  } = _deps;

  // Defense-in-depth: real (non-dry-run) submissions require an explicit
  // --yes confirmation AND a default --limit cap of 5 (overridable). This
  // gate lives at the CLI layer only; runBatch() itself stays pure so unit
  // tests can drive it without ceremony.
  if (!dryRun && !opts.yes) {
    throw new Error(
      'Real submission requires --yes flag.\n' +
      '  Run with --dry-run to preview, or add --yes to confirm.\n' +
      '  Recommended: start with --limit 1 and verify before scaling up.'
    );
  }
  const limitWasProvided = opts.limit !== null && opts.limit !== undefined;
  const effectiveLimit = limitWasProvided
    ? opts.limit
    : (dryRun ? null : 5);

  let triageReport;
  if (triageSource) {
    triageReport = loadTriageReport(triageSource);
  } else {
    // Live triage. We pass through category so a focused run doesn't probe
    // unrelated targets.
    const config = await loadConfigFn();
    triageReport = await triageFn({
      json: true,
      browser: false,
      limit: null,
      category: opts.category || null,
      includeManual: false,
      config,
    });
  }

  const config = await loadConfigFn();
  const product = config.product;
  if (!product || !product.name || !product.url) {
    throw new Error('config.yaml must define product { name, url, email }');
  }

  const targets = filterAndSort(prepareTargets(triageReport.results || []), {
    limit: effectiveLimit,
    category: opts.category,
    priority: opts.priority,
    valueTier: opts.valueTier,
  });

  const forceMap = parseForceFlag(opts.force || '');

  console.log(`Batch executor: ${targets.length} targets selected`);
  console.log(`  productHash: ${productHash(product)}  dryRun=${dryRun}`);
  if (!dryRun && !limitWasProvided) {
    console.log(`  safety: defaulting --limit to ${effectiveLimit} (override with --limit)`);
  }
  if (forceMap.size) {
    console.log(`  force: ${[...forceMap.entries()].map(([k, v]) => `${k}:${v}`).join(', ')}`);
  }
  console.log('');

  const { summary } = await runBatchFn(targets, {
    product,
    config,
    dryRun,
    forceMap,
    submissionsPath,
  });

  return { summary, effectiveLimit, targetsCount: targets.length };

  console.log('\nSummary:');
  for (const [key, val] of Object.entries(summary)) {
    if (val) console.log(`  ${key.padEnd(10)} ${val}`);
  }
}

// CLI shim — used when invoked directly. Subcommand integration lives in
// cli.js.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--yes') opts.yes = true;
    else if (a === '--limit') opts.limit = parseInt(args[++i], 10);
    else if (a === '--category') opts.category = args[++i];
    else if (a === '--priority') opts.priority = args[++i];
    else if (a === '--value-tier') opts.valueTier = parseInt(args[++i], 10);
    else if (a === '--force') opts.force = args[++i];
    else if (a === '--triage-source') opts.triageSource = args[++i];
    else if (a === '--submissions-path') opts.submissionsPath = args[++i];
  }
  runBatchCli(opts).catch((err) => {
    console.error('batch-submit failed:', err.message);
    process.exit(1);
  });
}
