// triage.js — Batch-classify targets before attempting submissions.
// The goal is to separate generic-ready forms from iframe providers,
// captcha/manual sites, closed/paid pages, and adapter-needed forms.

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { createSession } from './browser.js';
import { parseSnapshot } from './sites/generic.js';
import { flatten, loadTargetsDoc, TARGETS_FILE } from './yaml-utils.js';

const DEFAULT_CONCURRENCY = 6;
const DEFAULT_TIMEOUT_MS = 15000;

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

function detectProvider(dom = {}, text = '') {
  const haystack = `${text} ${(dom.iframes || []).join(' ')}`.toLowerCase();
  if (/typeform/.test(haystack)) return { provider: 'typeform', code: 'TYPEFORM_IFRAME' };
  if (/paperform/.test(haystack)) return { provider: 'paperform', code: 'PAPERFORM_IFRAME' };
  if (/airtable/.test(haystack)) return { provider: 'airtable', code: 'AIRTABLE_IFRAME' };
  if (/tally\.so|tally/.test(haystack)) return { provider: 'tally', code: 'TALLY_IFRAME' };
  if (/jinshuju|mikecrm|wjx|wenjuan/.test(haystack)) {
    return { provider: 'embedded-form', code: 'EMBEDDED_FORM_IFRAME' };
  }
  if (dom.iframes?.length) return { provider: 'iframe', code: 'IFRAME_FORM' };
  return null;
}

function hasCaptcha(dom = {}, text = '', snapshot = '') {
  const haystack = `${text} ${snapshot} ${(dom.iframes || []).join(' ')}`.toLowerCase();
  return /captcha|recaptcha|hcaptcha|turnstile|cloudflare/.test(haystack);
}

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

function result(bucket, code, automation, reasons = []) {
  return { bucket, code, automation, reasons };
}

export function classifyTriage({ status, finalUrl = '', bodyText = '', snapshot = '', dom = {} } = {}) {
  const text = normalizeText(bodyText).toLowerCase();
  const url = String(finalUrl || '').toLowerCase();

  if (status === null || status === undefined) {
    return result('manual-review', 'NETWORK_ERROR', 'manual', ['network error or timeout']);
  }
  if (url.startsWith('chrome-error://') || status === 404) {
    return result('dead', 'PAGE_UNREACHABLE', 'none', ['page unreachable']);
  }
  if (status >= 500) {
    return result('dead', 'SERVER_ERROR', 'none', [`http ${status}`]);
  }
  if (status >= 400) {
    return result('manual-review', 'HTTP_ERROR', 'manual', [`http ${status}`]);
  }
  if (/login|sign.?in|log.?in|create.?account|register/.test(url) ||
      (/login|sign.?in|create account|register/.test(text) && !/submit|add.*tool|description/.test(text))) {
    return result('manual-review', 'LOGIN_REQUIRED', 'manual', ['login required']);
  }
  if (/typeform is now closed|submissions?.*(closed|suspended)|free submissions?.*suspended|paid submission|paid .*submission|paid .*plan|checkout|buy now|\$\d+/.test(text)) {
    return result('manual-review', 'CLOSED_OR_PAID', 'manual', ['closed or paid']);
  }

  const fields = parseSnapshot(snapshot || '');
  const provider = detectProvider(dom, text);
  if (provider && !hasCoreFields(fields)) {
    return result('iframe-provider', provider.code, 'provider-adapter', [provider.provider]);
  }
  if (hasCaptcha(dom, text, snapshot)) {
    return result('manual-review', 'CAPTCHA', 'manual', ['captcha detected']);
  }
  if (hasCoreFields(fields)) {
    if (hasExtraRequiredControls(snapshot)) {
      return result('adapter-needed', 'EXTRA_REQUIRED_FIELDS', 'adapter', ['required non-text controls']);
    }
    return result('generic-ready', 'GENERIC_READY', 'auto', ['core fields detected']);
  }
  if (coreFieldCount(fields) > 0 || dom.forms > 0 || dom.inputs > 0) {
    return result('adapter-needed', 'PARTIAL_FORM', 'adapter', ['partial form detected']);
  }

  return result('manual-review', 'NO_FORM_DETECTED', 'manual', ['no recognizable form']);
}

export function collectTriageTargets(doc, { includeManual = false, category = null } = {}) {
  return flatten(doc).filter((f) => {
    if (category && f.categoryKey !== category) return false;
    if (f.entry.status === 'dead' || f.entry.status === 'paid') return false;
    if (includeManual) return true;
    return autoYes(f.entry.auto);
  });
}

export function summarizeTriage(items) {
  const buckets = {};
  for (const item of items) {
    buckets[item.bucket] = (buckets[item.bucket] || 0) + 1;
  }
  return { total: items.length, buckets };
}

export function writeTriageOutput(outputPath, output) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf-8');
}

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
    };
  } catch (err) {
    return {
      status: null,
      finalUrl: url,
      bodyText: err.message || String(err),
      snapshot: '',
      dom: { forms: 0, inputs: 0, iframes: [] },
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
        body: (document.body && document.body.innerText || '').slice(0, 4000)
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
    };
  } catch (err) {
    return {
      status: null,
      finalUrl: url,
      bodyText: err.message || String(err),
      snapshot: '',
      dom: { forms: 0, inputs: 0, iframes: [] },
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
      const classification = classifyTriage(page);
      return {
        name: target.entry.name,
        submit_url: target.entry.submit_url,
        category: target.categoryKey,
        bucket: classification.bucket,
        code: classification.code,
        automation: classification.automation,
        reasons: classification.reasons,
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
    process.stdout.write(`  ${bucket}: ${count}\n`);
  }

  process.stdout.write('\nTop actionable targets:\n');
  for (const item of output.results.slice(0, 50)) {
    process.stdout.write(`  ${item.bucket.padEnd(16)} ${item.name}\n`);
    process.stdout.write(`    ${item.code} — ${item.submit_url}\n`);
  }
}
