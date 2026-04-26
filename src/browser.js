// browser.js — Browser wrapper (bb-browser engine)
// rebrowser-playwright removed in v2.2; use --engine bb

function resolveEngine(config) {
  if (config._engine) return config._engine;
  if (config.browser?.engine) return config.browser.engine;
  return 'bb';
}

function exitPlaywrightDeprecated() {
  console.error('');
  console.error('✗ --engine playwright has been removed in v2.2.');
  console.error('  rebrowser-playwright is no longer installed.');
  console.error('');
  console.error('  Fix:');
  console.error('    npm install -g bb-browser');
  console.error('    bb-browser open about:blank');
  console.error('    node src/cli.js submit <site> --engine bb');
  console.error('');
  process.exit(1);
}

export async function withBrowser(config, fn) {
  const engine = resolveEngine(config);

  if (engine === 'playwright') {
    exitPlaywrightDeprecated();
  }

  const { BbPage, isBbAvailable } = await import('./bb.js');
  if (!isBbAvailable()) {
    console.error('✗ bb-browser not found.');
    console.error('  Install: npm install -g bb-browser');
    console.error('  Then run: bb-browser open about:blank');
    process.exit(1);
  }
  const { maybeUpdateBbSites } = await import('./bb-update.js');
  await maybeUpdateBbSites(config);
  const page = new BbPage(config);
  try {
    return await fn({ browser: null, context: null, page });
  } finally {
    await page.cleanup();
  }
}

export async function createSession(config = {}) {
  const engine = resolveEngine(config);

  if (engine === 'playwright') {
    exitPlaywrightDeprecated();
  }

  const { BbPage, isBbAvailable } = await import('./bb.js');
  if (!isBbAvailable()) {
    console.error('✗ bb-browser not found.');
    console.error('  Install: npm install -g bb-browser');
    process.exit(1);
  }
  const { maybeUpdateBbSites } = await import('./bb-update.js');
  await maybeUpdateBbSites(config);
  const page = new BbPage(config);
  return { page, close: async () => page.cleanup() };
}

export function delay(ms) {
  const jitter = Math.random() * ms * 0.3;
  return new Promise(r => setTimeout(r, ms + jitter));
}

export async function humanType(page, selector, text) {
  if (page.constructor.name === 'BbPage') {
    await page.evalFill(selector, text);
    return;
  }
  // Fallback for non-bb pages (should not occur in v2.2+)
  await page.click(selector);
  await delay(200);
  await page.fill(selector, '');
  for (const char of text) {
    await page.type(selector, char, { delay: 30 + Math.random() * 70 });
  }
}
