// submit.js — Dispatch submissions to site-specific or generic adapters.
// Every failure path returns a machine-readable { code, nextSteps } structure
// so both CLI rendering and Claude agent automation can act on it.

import { readdirSync } from 'fs';
import { utmUrl } from './config.js';
import { recordSubmission } from './tracker.js';

// Map error messages to structured codes + actionable next steps.
function classifyError(site, message) {
  const m = message.toLowerCase();
  const today = new Date().toISOString().slice(0, 10);

  if (m.includes('404') || m.includes('submit page no longer')) {
    return {
      code: 'PAGE_404',
      nextSteps: [
        { label: 'Mark site as dead', command: `node src/cli.js mark-dead ${site} --yes` },
      ],
    };
  }
  if (m.includes('login') || m.includes('sign-in') || m.includes('account')) {
    return {
      code: 'LOGIN_REQUIRED',
      nextSteps: [
        { label: 'Mark site as manual', command: `node src/cli.js mark-manual ${site} --yes` },
      ],
    };
  }
  if (m.includes('captcha')) {
    return {
      code: 'CAPTCHA_FAILED',
      nextSteps: [
        { label: 'Check screenshot', command: `open screenshots/${site}-${today}.png` },
        { label: 'Mark as done if submitted', command: `node src/cli.js mark-done ${site}` },
      ],
    };
  }
  if (m.includes('chrome') || m.includes('timeout') || m.includes('connect')) {
    return {
      code: 'CHROME_TIMEOUT',
      nextSteps: [
        {
          label: 'Restart Chrome',
          command: 'pkill -f "bb-browser" || true && bb-browser open about:blank',
        },
      ],
    };
  }
  return { code: 'UNKNOWN_ERROR', nextSteps: [] };
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
      await recordSubmission(site, 'failed', { code, error: result.error });
      if (jsonMode) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.error(`❌ ${checkUrl} returned 404 — submit page no longer exists.`);
        console.log('   Try visiting the site root to find the new submit URL.');
        renderNextSteps(nextSteps);
      }
      return result;
    }
    if (res && res.status >= 500) {
      const result = { status: 'failed', code: 'SERVER_ERROR', error: `HTTP ${res.status}`, nextSteps: [] };
      await recordSubmission(site, 'failed', { code: 'SERVER_ERROR', error: result.error });
      if (jsonMode) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.error(`❌ ${checkUrl} returned ${res.status} — site appears down.`);
      }
      return result;
    }
  }

  const startMs = Date.now();
  try {
    const adapterResult = await adapter.submit(product, config);
    const duration_ms = Date.now() - startMs;

    await recordSubmission(site, 'submitted', {
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
    const { code, nextSteps } = classifyError(site, e.message);
    await recordSubmission(site, 'failed', { code, error: e.message, duration_ms });

    const result = { status: 'failed', code, error: e.message, nextSteps };
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
