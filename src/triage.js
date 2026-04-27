// triage.js — Batch-classify targets before attempting submissions.
//
// New bucket model (v2.1):
//   recipe-ready          → targets with a recipes/<siteKey>.yaml config
//   provider-ready        → embedded iframe form (Paperform/Tally/Typeform/Airtable)
//   generic-ready         → simple visible HTML form, generic adapter handles it
//   custom-adapter-needed → has form fields but needs site-specific JS adapter
//   manual-review         → not automated; carries .reason sub-classification
//   dead                  → 404/500/unreachable
//
// manual-review.reason ∈ { captcha-required | login-required | paid | closed-submission | unknown }
//
// Backward-compat aliases for downstream report parsers (see summarizeTriage):
//   adapter-needed   ← recipe-ready + custom-adapter-needed
//   iframe-provider  ← provider-ready

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { createSession } from './browser.js';
import { parseSnapshot } from './sites/generic.js';
import { flatten, loadTargetsDoc, TARGETS_FILE } from './yaml-utils.js';

const DEFAULT_CONCURRENCY = 6;
const DEFAULT_TIMEOUT_MS = 15000;

// Categories we consider tier-2 by default when no explicit priority is set.
const TIER_2_CATEGORIES = new Set(['overseas_ai_directories', 'awesome_lists']);

function autoYes(value) {
  return value === true || String(value).toLowerCase() === 'yes';
}

function coreFieldCount(fields) {
  return ['name', 'url', 'email', 'description'].filter(k => fields?.[k]).length;
}

function hasCoreFields(fields) {
  return coreFieldCount(fields) >= 3 || (!!fields?.url && !!fields?.description);
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------------
// Provider detection
// ------------------------------------------------------------------

// Provider detection runs against the iframe URL list ONLY, never against body
// text. Bare-word matches (e.g. "tally") on body content cause false positives
// on words like "totally" / "mentally" / "metallic". Word boundaries (\b) are
// applied defensively to all provider names for the same reason.
//
// Per-provider regex used both for detection (against the joined iframe list)
// and for picking which iframe URL is the provider URL (single-URL match).
const PROVIDER_PATTERNS = [
  { provider: 'paperform', code: 'PAPERFORM_IFRAME', re: /\bpaperform\b/i },
  { provider: 'typeform', code: 'TYPEFORM_IFRAME', re: /\btypeform\b/i },
  { provider: 'tally', code: 'TALLY_IFRAME', re: /\btally(\.so)?\b/i },
  { provider: 'airtable', code: 'AIRTABLE_IFRAME', re: /\bairtable\b/i },
  { provider: 'jinshuju', code: 'JINSHUJU_IFRAME', re: /\bjinshuju\b/i },
  { provider: 'mikecrm', code: 'MIKECRM_IFRAME', re: /\bmikecrm\b/i },
  { provider: 'wjx', code: 'WJX_IFRAME', re: /\bwjx\b/i },
  { provider: 'wenjuan', code: 'WENJUAN_IFRAME', re: /\bwenjuan\b/i },
];

function detectProvider(dom = {}) {
  const iframes = (dom.iframes || []).join(' ').toLowerCase();
  if (!iframes) return null;
  for (const p of PROVIDER_PATTERNS) {
    if (p.re.test(iframes)) return { provider: p.provider, code: p.code };
  }
  return null;
}

/**
 * Given the detected provider name and the iframe URL list, pick the iframe
 * URL whose host matches the provider regex. Returns the first match, or
 * `null` if no iframe matches (defensive — detection ran against the joined
 * string so at least one should match in practice).
 *
 * Exported so downstream consumers (provider adapters, smoke scripts) can
 * recover the iframe src given a fresh dom snapshot without re-detecting.
 */
export function pickProviderIframeUrl(providerName, iframes = []) {
  if (!providerName) return null;
  const entry = PROVIDER_PATTERNS.find((p) => p.provider === providerName);
  if (!entry) return null;
  for (const url of iframes) {
    if (typeof url === 'string' && entry.re.test(url)) return url;
  }
  return null;
}

// ------------------------------------------------------------------
// Captcha detection
// Selectors covered:
//   iframe[src*="challenges.cloudflare.com"]  (Turnstile)
//   .h-captcha                                 (hCaptcha widget)
//   .g-recaptcha                               (Google reCAPTCHA widget)
//   script[src*="recaptcha"] / script[src*="hcaptcha"]
// ------------------------------------------------------------------

function hasCaptcha(dom = {}, text = '', snapshot = '', html = '') {
  const iframes = (dom.iframes || []).join(' ').toLowerCase();
  // Turnstile / Cloudflare challenge iframes
  if (/challenges\.cloudflare\.com|turnstile/i.test(iframes)) return true;
  // reCAPTCHA / hCaptcha iframes
  if (/recaptcha|hcaptcha/i.test(iframes)) return true;

  const rawHtml = String(html || '').toLowerCase();
  if (/class=["'][^"']*\bh-captcha\b/.test(rawHtml)) return true;
  if (/class=["'][^"']*\bg-recaptcha\b/.test(rawHtml)) return true;
  if (/<script[^>]+src=["'][^"']*recaptcha/.test(rawHtml)) return true;
  if (/<script[^>]+src=["'][^"']*hcaptcha/.test(rawHtml)) return true;
  if (/challenges\.cloudflare\.com/.test(rawHtml)) return true;

  // Fallback to text-based heuristics (matches older browser-mode triage)
  const haystack = `${text} ${snapshot}`.toLowerCase();
  if (/recaptcha|hcaptcha|turnstile/.test(haystack)) return true;
  // Plain "captcha" word — only flag when explicit, avoid matching unrelated copy.
  if (/\bcaptcha\b/.test(haystack) && !/no captcha|without captcha/.test(haystack)) return true;
  return false;
}

// ------------------------------------------------------------------
// Login wall detection
// ------------------------------------------------------------------

function hasLoginWall(finalUrl = '', text = '') {
  const url = String(finalUrl || '').toLowerCase();
  // Path-based: redirected to /login, /signin, /sign-in, /signup, /sign-up, /register
  if (/\/(log[-_]?in|sign[-_]?in|sign[-_]?up|register|create[-_]?account)(\b|\/|\?)/.test(url)) {
    return true;
  }
  const t = String(text || '').toLowerCase();
  if (/login required|please (sign|log)\s?in|sign in to (submit|continue)|you must (be )?(logged|signed) in/.test(t)) {
    return true;
  }
  return false;
}

// ------------------------------------------------------------------
// Paid submission detection
// Looks for $ pricing + payment language. Browser mode could refine this with
// proximity-to-button DOM measurement; HTTP mode uses bodyText globally.
// ------------------------------------------------------------------

function hasPaidSignals(text = '', snapshot = '') {
  const haystack = `${text} ${snapshot}`.toLowerCase();
  // Strong signals: explicit price + payment / featured language
  const hasPrice = /\$\s?\d{1,4}/.test(haystack);
  const paywall = /(featured submission|premium submission|pay\s+(now|to|\$)|sponsored listing|paid plan|paid submission|submissions?\s+suspended)/i
    .test(haystack);
  if (hasPrice && paywall) return true;
  if (/featured submission/.test(haystack)) return true;
  if (/(paid|premium)\s+submission/.test(haystack)) return true;
  if (/checkout|buy now/.test(haystack) && hasPrice) return true;
  return false;
}

function hasClosedSignals(text = '') {
  return /typeform is now closed|submissions?\s+(closed|suspended)|free submissions?\s+suspended|no longer accepting/.test(
    String(text || '').toLowerCase()
  );
}

// ------------------------------------------------------------------
// Adapter-needed heuristics (control types that generic adapter can't handle)
// ------------------------------------------------------------------

function hasExtraRequiredControls(snapshot = '') {
  const s = snapshot.toLowerCase();
  if (/radio\s+\[ref=\d+\]/.test(s)) return true;
  if (/checkbox\s+\[ref=\d+\]/.test(s) && /terms|agree|required|newsletter|source/.test(s)) return true;
  if (/presentation\s+\[ref=\d+\].*(upload|file|logo|screenshot|image)/.test(s)) return true;
  if (/button\s+\[ref=\d+\].*(upload|file|logo|screenshot|choose)/.test(s)) return true;
  if (/label\s+\[ref=\d+\]\s+"[^"]*(category|pricing|price|tags|logo|screenshot)[^"]*\*/.test(s)) return true;
  if (/combobox\s+\[ref=\d+\]\s+"[^"]*(select|category|pricing|price)/.test(s)) return true;
  return false;
}

// ------------------------------------------------------------------
// Recipe-ready detection
// Convention: Task 2 will create recipes/<siteKey>.yaml. We only check
// existence so this module stays decoupled from the future recipe runtime.
// ------------------------------------------------------------------

const RECIPES_DIR = 'recipes';

function recipeFileExists(siteKey) {
  if (!siteKey) return false;
  try {
    return existsSync(join(RECIPES_DIR, `${siteKey}.yaml`));
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Result helpers
// ------------------------------------------------------------------

function result(bucket, code, automation, notes = [], extra = {}) {
  return { bucket, code, automation, notes, provider_url: null, ...extra };
}

function manual(reason, code, notes = []) {
  return result('manual-review', code, 'manual', notes, { reason });
}

// ------------------------------------------------------------------
// value_tier heuristic
// tier-1: explicit priority: high OR value_tier: 1
// tier-2: explicit priority: medium OR category in TIER_2_CATEGORIES
// tier-3: everything else
// ------------------------------------------------------------------

export function computeValueTier(entry = {}, categoryKey = null) {
  if (entry?.value_tier === 1 || entry?.value_tier === '1') return 1;
  const priority = String(entry?.priority || '').toLowerCase();
  if (priority === 'high') return 1;
  if (entry?.value_tier === 2 || entry?.value_tier === '2') return 2;
  if (priority === 'medium') return 2;
  if (categoryKey && TIER_2_CATEGORIES.has(categoryKey)) return 2;
  return 3;
}

// ------------------------------------------------------------------
// Main classifier
// ------------------------------------------------------------------

/**
 * Dispatch order: dead → captcha → login → closed-submission → paid → recipe →
 * provider → field-detection → manual-review fallback.
 *
 * Hard walls (captcha / login / paid / closed) are checked BEFORE recipe and
 * provider because they block automation regardless of adapter availability.
 * Per ADR-007, CAPTCHA is fail-fast — a site with both a recipe and a captcha
 * cannot be auto-submitted by the recipe runtime either.
 */
export function classifyTriage({
  status,
  finalUrl = '',
  bodyText = '',
  snapshot = '',
  dom = {},
  html = '',
  siteKey = null,
  hasRecipe = undefined,
} = {}) {
  const text = normalizeText(bodyText).toLowerCase();
  const url = String(finalUrl || '').toLowerCase();

  // Network / HTTP errors first (dead bucket)
  if (status === null || status === undefined) {
    return manual('unknown', 'NETWORK_ERROR', ['network error or timeout']);
  }
  if (url.startsWith('chrome-error://') || status === 404) {
    return result('dead', 'PAGE_UNREACHABLE', 'none', ['page unreachable']);
  }
  if (status >= 500) {
    return result('dead', 'SERVER_ERROR', 'none', [`http ${status}`]);
  }
  if (status >= 400) {
    return manual('unknown', 'HTTP_ERROR', [`http ${status}`]);
  }

  // Captcha — hard wall, blocks even recipe-ready sites (ADR-007).
  if (hasCaptcha(dom, text, snapshot, html)) {
    return manual('captcha-required', 'CAPTCHA_REQUIRED', ['captcha detected']);
  }

  // Login wall — hard wall, recipes can't synthesize a session.
  if (hasLoginWall(finalUrl, text)) {
    return manual('login-required', 'LOGIN_REQUIRED', ['login required']);
  }

  // Closed submissions — hard wall.
  if (hasClosedSignals(text)) {
    return manual('closed-submission', 'SUBMISSIONS_CLOSED', ['submissions closed']);
  }

  // Paid submissions — hard wall.
  if (hasPaidSignals(text, snapshot)) {
    return manual('paid', 'PAID_SUBMISSION', ['paid submission']);
  }

  // Recipe-ready takes precedence over generic/provider auto-detection.
  const recipePresent = hasRecipe === undefined ? recipeFileExists(siteKey) : !!hasRecipe;
  if (recipePresent) {
    return result('recipe-ready', 'RECIPE_AVAILABLE', 'recipe', ['recipe configured']);
  }

  const fields = parseSnapshot(snapshot || '');
  const provider = detectProvider(dom);

  // Iframe-embedded provider (Paperform / Tally / Typeform / Airtable / CN forms).
  if (provider && !hasCoreFields(fields)) {
    const providerUrl = pickProviderIframeUrl(provider.provider, dom.iframes || []);
    const extra = { provider: provider.provider, provider_url: providerUrl || null };
    return result('provider-ready', provider.code, 'provider-adapter', [provider.provider], extra);
  }

  if (hasCoreFields(fields)) {
    if (hasExtraRequiredControls(snapshot)) {
      return result('custom-adapter-needed', 'EXTRA_REQUIRED_FIELDS', 'adapter', [
        'required non-text controls',
      ]);
    }
    return result('generic-ready', 'GENERIC_READY', 'auto', ['core fields detected']);
  }

  if (coreFieldCount(fields) > 0 || dom.forms > 0 || dom.inputs > 0) {
    return result('custom-adapter-needed', 'PARTIAL_FORM', 'adapter', ['partial form detected']);
  }

  return manual('unknown', 'NO_FORM_DETECTED', ['no recognizable form']);
}

// ------------------------------------------------------------------
// Target collection
// ------------------------------------------------------------------

export function collectTriageTargets(doc, { includeManual = false, category = null } = {}) {
  return flatten(doc).filter((f) => {
    if (category && f.categoryKey !== category) return false;
    if (f.entry.status === 'dead' || f.entry.status === 'paid') return false;
    if (includeManual) return true;
    return autoYes(f.entry.auto);
  });
}

// ------------------------------------------------------------------
// Summary with backward-compat aliases + tier breakdown
// ------------------------------------------------------------------

export function summarizeTriage(items) {
  const buckets = {};
  const manual_reasons = {};
  const tiers = { 1: 0, 2: 0, 3: 0 };
  const bucket_by_tier = {};

  for (const item of items) {
    const b = item.bucket;
    buckets[b] = (buckets[b] || 0) + 1;

    if (b === 'manual-review' && item.reason) {
      manual_reasons[item.reason] = (manual_reasons[item.reason] || 0) + 1;
    }

    const tier = item.value_tier || 3;
    if (tiers[tier] !== undefined) tiers[tier] += 1;

    bucket_by_tier[b] = bucket_by_tier[b] || { 1: 0, 2: 0, 3: 0 };
    if (bucket_by_tier[b][tier] !== undefined) bucket_by_tier[b][tier] += 1;
  }

  // Backward-compat aliases for downstream reports.
  // adapter-needed  = recipe-ready + custom-adapter-needed (any "needs adapter or recipe" work)
  // iframe-provider = provider-ready
  const aliasAdapter = (buckets['recipe-ready'] || 0) + (buckets['custom-adapter-needed'] || 0);
  if (aliasAdapter > 0) buckets['adapter-needed'] = aliasAdapter;
  if (buckets['provider-ready']) buckets['iframe-provider'] = buckets['provider-ready'];

  return { total: items.length, buckets, manual_reasons, tiers, bucket_by_tier };
}

export function writeTriageOutput(outputPath, output) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf-8');
}

// ------------------------------------------------------------------
// Page fetch (HTTP mode)
// ------------------------------------------------------------------

function extractDomFromHtml(html) {
  const bodyText = normalizeText(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '));

  const iframes = [...html.matchAll(/<iframe\b[^>]*\bsrc=["']([^"']+)["']/gi)]
    .map(m => m[1])
    .slice(0, 10);

  return {
    bodyText,
    dom: {
      forms: (html.match(/<form\b/gi) || []).length,
      inputs: (html.match(/<(input|textarea|select)\b/gi) || []).length,
      iframes,
    },
  };
}

async function fetchPage(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 backlink-pilot triage',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    const html = await res.text().catch(() => '');
    const { bodyText, dom } = extractDomFromHtml(html);
    return {
      status: res.status,
      finalUrl: res.url || url,
      bodyText,
      snapshot: '',
      dom,
      html,
    };
  } catch (err) {
    return {
      status: null,
      finalUrl: url,
      bodyText: err.message || String(err),
      snapshot: '',
      dom: { forms: 0, inputs: 0, iframes: [] },
      html: '',
      error: err.message || String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function browserPage(url, config) {
  const session = await createSession({ ...config, _engine: 'bb' });
  const { page } = session;
  try {
    await page.goto(url);
    const snapshot = await page.snapshot().catch(() => '');
    let raw = null;
    try {
      raw = page._bb?.('eval', `JSON.stringify({
        href: location.href,
        forms: document.forms.length,
        inputs: document.querySelectorAll('input,textarea,select').length,
        iframes: Array.from(document.querySelectorAll('iframe')).map(f => f.src || '').filter(Boolean).slice(0, 10),
        body: (document.body && document.body.innerText || '').slice(0, 4000),
        outerHtml: document.documentElement.outerHTML.slice(0, 50000)
      })`);
    } catch {}
    const domInfo = raw ? JSON.parse(raw) : {};
    return {
      status: 200,
      finalUrl: domInfo.href || page.url(),
      bodyText: domInfo.body || '',
      snapshot,
      dom: {
        forms: domInfo.forms || 0,
        inputs: domInfo.inputs || 0,
        iframes: domInfo.iframes || [],
      },
      html: domInfo.outerHtml || '',
    };
  } catch (err) {
    return {
      status: null,
      finalUrl: url,
      bodyText: err.message || String(err),
      snapshot: '',
      dom: { forms: 0, inputs: 0, iframes: [] },
      html: '',
      error: err.message || String(err),
    };
  } finally {
    await session.close();
  }
}

async function mapConcurrent(items, concurrency, fn, onProgress) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
      onProgress?.(i + 1, items.length, items[i], results[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// Derive a stable site key from name (used for recipe lookup).
function siteKeyFromName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function triageTargets({
  json = false,
  browser = false,
  limit = null,
  category = null,
  includeManual = false,
  config = {},
  concurrency = DEFAULT_CONCURRENCY,
  outputPath = null,
} = {}) {
  if (!existsSync(TARGETS_FILE)) throw new Error(`${TARGETS_FILE} not found in cwd`);

  const doc = loadTargetsDoc();
  let targets = collectTriageTargets(doc, { includeManual, category });
  if (limit) targets = targets.slice(0, Number(limit));

  if (!json) {
    process.stderr.write(
      `Triage ${targets.length} targets (${browser ? 'browser' : 'http'} mode)...\n`
    );
  }

  const probe = browser
    ? (target) => browserPage(target.entry.submit_url, config)
    : (target) => fetchPage(target.entry.submit_url);

  const scanned = await mapConcurrent(
    targets,
    browser ? 1 : concurrency,
    async (target) => {
      const page = await probe(target);
      const siteKey = siteKeyFromName(target.entry.name);
      const classification = classifyTriage({ ...page, siteKey });
      const value_tier = computeValueTier(target.entry, target.categoryKey);
      return {
        name: target.entry.name,
        submit_url: target.entry.submit_url,
        category: target.categoryKey,
        bucket: classification.bucket,
        code: classification.code,
        automation: classification.automation,
        notes: classification.notes,
        reason: classification.reason || null,
        provider: classification.provider || null,
        provider_url: classification.provider_url || null,
        value_tier,
        status: page.status,
        final_url: page.finalUrl,
        dom: page.dom,
        error: page.error || null,
      };
    },
    (n, total, target, item) => {
      if (json) return;
      process.stderr.write(`  [${n}/${total}] ${item.bucket} ${target.entry.name}\n`);
    }
  );

  const summary = summarizeTriage(scanned);
  const output = { mode: browser ? 'browser' : 'http', summary, results: scanned };

  if (json) {
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  } else {
    renderTriage(output);
  }

  if (outputPath) {
    writeTriageOutput(outputPath, output);
    if (!json) process.stdout.write(`\nSaved triage report: ${outputPath}\n`);
  }

  return output;
}

function renderTriage(output) {
  process.stdout.write('\nTriage summary:\n');
  for (const [bucket, count] of Object.entries(output.summary.buckets)) {
    process.stdout.write(`  ${bucket.padEnd(22)} ${count}\n`);
  }

  if (output.summary.manual_reasons && Object.keys(output.summary.manual_reasons).length) {
    process.stdout.write('\nManual-review reasons:\n');
    for (const [reason, count] of Object.entries(output.summary.manual_reasons)) {
      process.stdout.write(`  ${reason.padEnd(22)} ${count}\n`);
    }
  }

  if (output.summary.tiers) {
    process.stdout.write('\nValue tiers:\n');
    for (const tier of [1, 2, 3]) {
      process.stdout.write(`  tier-${tier}                 ${output.summary.tiers[tier] || 0}\n`);
    }
  }

  if (output.summary.bucket_by_tier) {
    process.stdout.write('\nBucket × tier:\n');
    for (const [bucket, byTier] of Object.entries(output.summary.bucket_by_tier)) {
      process.stdout.write(
        `  ${bucket.padEnd(22)} t1=${byTier[1] || 0} t2=${byTier[2] || 0} t3=${byTier[3] || 0}\n`
      );
    }
  }

  process.stdout.write('\nTop actionable targets:\n');
  for (const item of output.results.slice(0, 50)) {
    const tierTag = item.value_tier ? `t${item.value_tier}` : 't?';
    process.stdout.write(`  [${tierTag}] ${item.bucket.padEnd(22)} ${item.name}\n`);
    process.stdout.write(`       ${item.code} — ${item.submit_url}\n`);
  }
}
