// submit.js — Dispatch submissions to site-specific or generic adapters.
// Every failure path returns a machine-readable { code, nextSteps } structure
// so both CLI rendering and Claude agent automation can act on it.

import { readdirSync, readFileSync } from 'fs';
import { utmUrl } from './config.js';
import { recordSubmission, productIdentity } from './tracker.js';
import { applyFailureVerdict } from './targets.js';

// Run verdict layer + render the auto-applied line. Centralized so the
// pre-flight 404/500 paths and the post-adapter catch share one render.
function runVerdict(site, code, opts) {
  if (opts?.noAutoVerdict) return null;
  let verdict;
  try {
    verdict = applyFailureVerdict(site, code);
  } catch (e) {
    // Verdict layer must never break a submission. Surface and move on.
    console.error(`  ⚠️  verdict layer error: ${e.message}`);
    return null;
  }
  if (verdict?.applied && !opts?.json) {
    const opStr = Object.entries(verdict.op).map(([k, v]) => `${k}=${v}`).join(', ');
    console.log(`  🤖 Auto-applied to targets.yaml: ${opStr}${verdict.name ? ` → ${verdict.name}` : ''}`);
  } else if (verdict?.skipped === 'streak' && !opts?.json) {
    console.log(`  ⏸  Verdict held: ${verdict.streak}/${verdict.threshold} consecutive ${code} (will auto-block on next failure)`);
  }
  return verdict;
}

// Map an error to a structured code + actionable next steps. Prefers an
// explicit e.code (set by adapters at the throw site, where the semantics are
// known); falls back to message-string sniffing for legacy / library errors.
function classifyError(site, err) {
  const today = new Date().toISOString().slice(0, 10);
  const message = typeof err === 'string' ? err : (err?.message || '');
  const explicitCode = typeof err === 'object' ? err?.code : null;
  const m = message.toLowerCase();

  const code = explicitCode || sniffCode(m);

  switch (code) {
    case 'PAGE_404':
      return { code, nextSteps: [{ label: 'Mark site as dead', command: `node src/cli.js mark-dead ${site} --yes` }] };
    case 'LOGIN_REQUIRED':
      return { code, nextSteps: [{ label: 'Mark site as manual', command: `node src/cli.js mark-manual ${site} --yes` }] };
    case 'CAPTCHA_FAILED':
      return {
        code,
        nextSteps: [
          { label: 'Check screenshot', command: `open screenshots/${site}-${today}.png` },
          { label: 'Mark as done if submitted', command: `node src/cli.js mark-done ${site}` },
        ],
      };
    case 'CHROME_TIMEOUT':
      return {
        code,
        nextSteps: [{ label: 'Restart Chrome', command: 'pkill -f "bb-browser" || true && bb-browser open about:blank' }],
      };
    case 'IFRAME_FORM':
    case 'PAID_WALL':
    case 'NO_FIELDS':
    case 'SERVER_ERROR':
      // Verdict layer handles targets.yaml updates; no per-error CLI hint needed.
      return { code, nextSteps: [] };
    default:
      return { code: 'UNKNOWN_ERROR', nextSteps: [] };
  }
}

function sniffCode(m) {
  if (m.includes('404') || m.includes('submit page no longer')) return 'PAGE_404';
  if (m.includes('login') || m.includes('sign-in') || m.includes('account')) return 'LOGIN_REQUIRED';
  if (m.includes('captcha')) return 'CAPTCHA_FAILED';
  if (m.includes('chrome') || m.includes('timeout') || m.includes('connect')) return 'CHROME_TIMEOUT';
  return 'UNKNOWN_ERROR';
}

async function loadAdapter(site) {
  if (site.startsWith('http')) {
    const generic = await import('./sites/generic.js');
    return { ...generic.default, _targetUrl: site };
  }
  try {
    const mod = await import(`./sites/${site}.js`);
    return mod.default || mod;
  } catch {
    return null;
  }
}

export async function submit(site, opts) {
  const { config } = opts;
  const jsonMode = !!opts.json;

  const adapter = await loadAdapter(site);
  if (!adapter) {
    const msg = {
      status: 'error',
      code: 'NO_ADAPTER',
      message: `No adapter for "${site}".`,
      nextSteps: [
        { label: 'List available sites', command: 'node src/cli.js submit --help' },
        { label: 'Use generic adapter', command: `node src/cli.js submit https://${site}.com/submit --engine bb` },
      ],
    };
    if (jsonMode) {
      console.log(JSON.stringify(msg, null, 2));
    } else {
      console.error(`❌ ${msg.message}`);
      console.log('\nAvailable sites:');
      const files = readdirSync(new URL('./sites/', import.meta.url));
      for (const f of files) {
        if (f.endsWith('.js')) console.log(`  - ${f.replace('.js', '')}`);
      }
      console.log('\nOr pass a URL directly:');
      console.log('  node src/cli.js submit https://example.com/submit --engine bb');
    }
    process.exit(1);
  }

  if (adapter.engine) config._engine = adapter.engine;
  if (adapter._targetUrl) config._targetUrl = adapter._targetUrl;

  const product = { ...config.product, utm_url: utmUrl(config, site) };
  if (opts.descriptionFile) {
    const text = readFileSync(opts.descriptionFile, 'utf-8').trim();
    if (text) product.submit_text = text;
  }
  // Stamp product identity onto every record this run writes, so submissions.yaml
  // rows are filterable by product even though the file is shared across configs.
  const identity = productIdentity(config.product);

  console.log(`\n🚀 Submitting "${product.name}" to ${site}`);
  if (opts.dryRun) {
    console.log('  [DRY RUN] Would submit:', JSON.stringify(product, null, 2));
    return;
  }

  // Pre-flight HTTP check — skip dead sites before launching browser
  const checkUrl = adapter._targetUrl || adapter.url;
  if (checkUrl) {
    const res = await fetch(checkUrl, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);

    if (res?.status === 404) {
      const { code, nextSteps } = classifyError(site, '404');
      const result = { status: 'failed', code, error: '404 — submit page gone', nextSteps };
      await recordSubmission(site, 'failed', { ...identity, code, error: result.error });
      const verdict = runVerdict(site, code, { json: jsonMode, noAutoVerdict: opts.noAutoVerdict });
      if (jsonMode) {
        console.log(JSON.stringify({ ...result, verdict }, null, 2));
      } else {
        console.error(`❌ ${checkUrl} returned 404 — submit page no longer exists.`);
        console.log('   Try visiting the site root to find the new submit URL.');
        renderNextSteps(nextSteps);
      }
      return { ...result, verdict };
    }
    if (res && res.status >= 500) {
      const result = { status: 'failed', code: 'SERVER_ERROR', error: `HTTP ${res.status}`, nextSteps: [] };
      await recordSubmission(site, 'failed', { ...identity, code: 'SERVER_ERROR', error: result.error });
      const verdict = runVerdict(site, 'SERVER_ERROR', { json: jsonMode, noAutoVerdict: opts.noAutoVerdict });
      if (jsonMode) {
        console.log(JSON.stringify({ ...result, verdict }, null, 2));
      } else {
        console.error(`❌ ${checkUrl} returned ${res.status} — site appears down.`);
      }
      return { ...result, verdict };
    }
  }

  const startMs = Date.now();
  try {
    const adapterResult = await adapter.submit(product, config);
    const duration_ms = Date.now() - startMs;

    await recordSubmission(site, 'submitted', {
      ...identity,
      url: adapterResult?.url,
      confirmation: adapterResult?.confirmation,
      duration_ms,
    });

    const result = { status: 'submitted', site, duration_ms, url: adapterResult?.url };
    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`✅ Submitted to ${site}! (${(duration_ms / 1000).toFixed(1)}s)`);
      if (adapterResult?.confirmation) console.log(`  Confirmation: ${adapterResult.confirmation}`);
    }
    return result;
  } catch (e) {
    const duration_ms = Date.now() - startMs;
    const { code, nextSteps } = classifyError(site, e);
    await recordSubmission(site, 'failed', { ...identity, code, error: e.message, duration_ms });
    const verdict = runVerdict(site, code, { json: jsonMode, noAutoVerdict: opts.noAutoVerdict });

    const result = { status: 'failed', code, error: e.message, nextSteps, verdict };
    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error(`❌ Failed: ${e.message}`);
      renderNextSteps(nextSteps);
    }
    return result;
  }
}

function renderNextSteps(nextSteps) {
  if (!nextSteps?.length) return;
  console.log('\n  Next steps:');
  for (const step of nextSteps) {
    console.log(`    ${step.label}:`);
    console.log(`      ${step.command}`);
  }
}
