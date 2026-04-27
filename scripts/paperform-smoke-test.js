#!/usr/bin/env node
// paperform-smoke-test.js — Open a Paperform-hosted form in bb-browser, run
// the provider adapter in dryRun mode, and print the discovered question
// fields. NEVER fills, NEVER clicks submit (no fill code path exists yet).
//
// Usage:
//   node scripts/paperform-smoke-test.js <paperform-url|host-page-url>
//
// Examples:
//   bb-browser open about:blank
//   # 1. Direct iframe URL
//   node scripts/paperform-smoke-test.js https://aitool.paperform.co/
//   # 2. Host page URL — script will fetch + extract the iframe src for you
//   node scripts/paperform-smoke-test.js https://aitoolsdirectory.com/submit-tool
//
// Defense-in-depth:
//   - DRY_RUN const is hardcoded true. The script hard-fails if it ever
//     becomes anything else.
//   - The adapter itself (src/sites/providers/paperform.js) also throws
//     unless dryRun === true, so even a bug here would be caught downstream.
//   - Aborts if the Paperform page contains a Cloudflare Turnstile or
//     reCAPTCHA / hCaptcha signal — we don't try to solve them.

import { withBrowser } from '../src/browser.js';
import { loadConfig } from '../src/config.js';
import { submit, isPaperformUrl } from '../src/sites/providers/paperform.js';
import { pickProviderIframeUrl } from '../src/triage.js';

const DRY_RUN = true; // immutable contract

function fail(msg) {
  console.error(`X ${msg}`);
  process.exit(1);
}

async function resolveIframeUrl(input) {
  if (isPaperformUrl(input)) return input;

  // Treat as host page; fetch and pull the first Paperform iframe src.
  let html = '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(input, {
      signal: controller.signal,
      headers: { 'User-Agent': 'backlink-pilot/1.0 paperform-smoke' },
    });
    if (!res.ok) fail(`Host returned HTTP ${res.status} for ${input}`);
    html = await res.text();
  } catch (e) {
    if (e.name === 'AbortError') fail(`Host page timed out after 15s: ${input}`);
    fail(`fetch failed for ${input}: ${e.message}`);
  } finally {
    clearTimeout(timeout);
  }
  const iframes = [...html.matchAll(/<iframe\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => m[1]);
  const url = pickProviderIframeUrl('paperform', iframes);
  if (!url) fail(`No Paperform iframe found on ${input}`);
  return url;
}

async function main() {
  const arg = process.argv[2];
  if (!arg) fail('Usage: node scripts/paperform-smoke-test.js <paperform-url|host-page-url>');
  if (DRY_RUN !== true) fail('DRY_RUN constant tampered with — refusing to run.');

  const config = await loadConfig();
  const iframeUrl = await resolveIframeUrl(arg);

  console.log(`> Paperform smoke test`);
  console.log(`  Input: ${arg}`);
  console.log(`  Resolved iframe URL: ${iframeUrl}`);
  console.log(`  dryRun: ${DRY_RUN}`);
  console.log('');

  await withBrowser({ ...config, _engine: 'bb' }, async ({ page }) => {
    // Pre-flight CAPTCHA check on the paperform page itself.
    await page.goto(iframeUrl);
    await new Promise((r) => setTimeout(r, 1500));

    const html = (await page.content().catch(() => '')) || '';
    if (/challenges\.cloudflare\.com|turnstile/i.test(html)) {
      fail('Paperform page contains Cloudflare Turnstile — aborting (no CAPTCHA solving).');
    }
    if (/g-recaptcha|h-captcha|recaptcha\/api\.js|hcaptcha\.com/i.test(html)) {
      fail('Paperform page contains reCAPTCHA/hCaptcha — aborting.');
    }

    console.log('  > Discovering question fields (dryRun)...');
    const result = await submit(config.product || {}, {
      dryRun: DRY_RUN,
      url: iframeUrl,
      page,
    });

    console.log('');
    console.log('=== Discovered fields ===');
    console.log(JSON.stringify(result.fields, null, 2));
    console.log('');
    console.log(`Total: ${result.fields.length} field(s).`);
    console.log('OK Smoke test complete (no fill, no submit clicked).');
  });
}

main().catch((e) => fail(e.stack || e.message));
