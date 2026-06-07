// generic.js — Universal directory submission adapter using bb-browser
// Works with any directory site by auto-detecting form fields via snapshot

import { withBrowser, delay } from '../browser.js';

// Field detection patterns (reused from batch-submit.js proven selectors)
const FIELD_PATTERNS = {
  nameStrong: /product|app.?name|tool.?name|startup|software|site.?name|title/i,
  nameWeak: /\bname\b/i,
  url: /url|website|web.?site|link|homepage|domain/i,
  email: /email|mail|e-mail/i,
  description: /desc|description|about|summary|detail|intro|introduc|brief|tagline|one.?sentence/i,
};

const SUBMIT_PATTERNS = /submit|send|add|post|create|list|suggest|save/i;
const COOKIE_BUTTON_PATTERNS = /accept|agree|allow|consent|ok|got it|continue/i;

function cleanLabel(label) {
  return (label || '').replace(/\s*\*\s*$/g, '').replace(/\s+/g, ' ').trim();
}

function parseSnapshotLine(line) {
  const refMatch = line.match(/^(\w+)\s+\[ref=(\d+)\]\s*"?([^"]*)"?/);
  if (!refMatch) return null;
  const [, role, refNum, rawLabel] = refMatch;
  return { role, ref: `@${refNum}`, label: cleanLabel(rawLabel) };
}

function hasCoreFields(fields) {
  const count = ['name', 'url', 'email', 'description'].filter(k => fields[k]).length;
  return count >= 3 || (!!fields.url && !!fields.description);
}

function formatDetected(fields) {
  return Object.entries(fields)
    .filter(([k, v]) => !k.startsWith('_') && v)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}

/**
 * Parse bb-browser snapshot output to find interactive elements
 * Actual bb-browser format: "textbox [ref=3] \"Name\"" or "button [ref=7] \"Submit\""
 */
export function parseSnapshot(snapshot) {
  const fields = {
    name: null,
    url: null,
    email: null,
    description: null,
    submit: null,
    _nameStrength: null,
  };
  const lines = snapshot.split('\n');
  let pendingLabel = '';

  for (const line of lines) {
    const parsed = parseSnapshotLine(line);
    if (!parsed) continue;

    const { role, ref, label } = parsed;
    const labelLower = label.toLowerCase();

    if (role === 'label') {
      pendingLabel = label;
      continue;
    }

    if (role === 'textbox' || role === 'combobox' || role === 'textarea') {
      const context = cleanLabel(`${pendingLabel} ${label}`).toLowerCase();

      if (FIELD_PATTERNS.url.test(context) && !fields.url) fields.url = ref;
      else if (FIELD_PATTERNS.email.test(context) && !fields.email) fields.email = ref;
      else if (FIELD_PATTERNS.description.test(context) && !fields.description) fields.description = ref;
      else if (FIELD_PATTERNS.nameStrong.test(context)) {
        if (!fields.name || fields._nameStrength !== 'strong') {
          fields.name = ref;
          fields._nameStrength = 'strong';
        }
      } else if (FIELD_PATTERNS.nameWeak.test(context) && !fields.name) {
        fields.name = ref;
        fields._nameStrength = 'weak';
      }
      pendingLabel = '';
    }

    // Prefer button over link — nav links also match submit patterns but aren't form buttons
    if (role === 'button' && SUBMIT_PATTERNS.test(labelLower)) {
      if (!fields.submit) fields.submit = ref;
    }
  }

  return fields;
}

function findCookieButton(snapshot) {
  for (const line of snapshot.split('\n')) {
    const parsed = parseSnapshotLine(line);
    if (!parsed || parsed.role !== 'button') continue;
    if (COOKIE_BUTTON_PATTERNS.test(parsed.label)) return parsed.ref;
  }
  return null;
}

async function dismissCookieWall(page) {
  const bodyText = await page.textContent('body').catch(() => '');
  if (!/cookie|consent|gdpr|privacy preferences/i.test(bodyText)) return false;

  const snapshot = await page.snapshot().catch(() => '');
  const ref = findCookieButton(snapshot);
  if (!ref) return false;

  console.log(`  🍪 Dismissing cookie banner (${ref})`);
  await page.click(ref);
  await delay(800);
  return true;
}

async function scanFormFields(page) {
  // Conservative SPA fallback: 5th attempt waits 8s for slow JS hydration
  // before we give up and throw NO_FIELDS.
  const attempts = [
    { label: 'initial', wait: 0, scroll: 0 },
    { label: 'wait', wait: 3000, scroll: 0 },
    { label: 'scroll', wait: 1000, scroll: 900 },
    { label: 'deep-scroll', wait: 1000, scroll: 1400 },
    { label: 'long-wait', wait: 8000, scroll: 0 },
  ];
  let last = { name: null, url: null, email: null, description: null, submit: null, _nameStrength: null };

  for (const attempt of attempts) {
    if (attempt.wait) await delay(attempt.wait);
    if (attempt.scroll && typeof page.scroll === 'function') {
      await page.scroll('down', attempt.scroll).catch(() => {});
      await delay(600);
    }

    const snapshot = await page.snapshot();
    const fields = parseSnapshot(snapshot);
    last = fields;

    const detected = formatDetected(fields);
    console.log(`  📋 Scan ${attempt.label}: ${detected || 'none'}`);
    if (hasCoreFields(fields)) return { fields, snapshot };
  }

  return { fields: last, snapshot: '' };
}

async function detectEmbeddedForm(page) {
  let raw = null;
  try {
    raw = page._bb?.('eval', `JSON.stringify({
      iframes: Array.from(document.querySelectorAll('iframe')).map(f => f.src || '').filter(Boolean),
      body: (document.body && document.body.innerText || '').slice(0, 1500)
    })`);
  } catch {}
  if (!raw) return null;

  let info;
  try { info = JSON.parse(raw); } catch { return null; }

  const haystack = `${info.body || ''} ${(info.iframes || []).join(' ')}`.toLowerCase();
  if (/typeform/.test(haystack)) return 'Typeform';
  if (/airtable/.test(haystack)) return 'Airtable';
  if (/tally\.so|tally/.test(haystack)) return 'Tally';
  if (/jinshuju|mikecrm|wjx|wenjuan/.test(haystack)) return 'embedded form';
  if (info.iframes?.length) return `iframe (${info.iframes.length})`;
  return null;
}

export default {
  name: 'generic',
  url: null,
  auth: 'none',
  captcha: 'none',
  engine: 'bb', // forces bb-browser

  async submit(product, config) {
    const targetUrl = config._genericUrl || config._targetUrl;
    if (!targetUrl) throw new Error('No target URL provided for generic submission');

    return withBrowser({ ...config, _engine: 'bb' }, async ({ page }) => {
      // 1. Navigate to submission page
      console.log(`  📄 Opening ${targetUrl}`);
      await page.goto(targetUrl);
      await delay(2000);

      // 1.5. Validate page — check for dead/login/paid pages
      const pageUrl = typeof page.url === 'function' ? page.url() : '';
      const pageTitle = await page.textContent('title').catch(() => '');
      const bodyText = await page.textContent('body').catch(() => '');
      const bodySnippet = bodyText.substring(0, 500).toLowerCase();

      if (/404|not found|page not found/.test(bodySnippet) || /404/.test(pageTitle)) {
        throw Object.assign(new Error('Page returned 404 — submit URL may have changed. Check the site root.'), { code: 'PAGE_404' });
      }
      if (/500|server error|internal error/.test(bodySnippet)) {
        throw Object.assign(new Error('Page returned 500 Server Error — site may be down.'), { code: 'SERVER_ERROR' });
      }
      if (/login|sign.?in|log.?in|create.?account/.test(pageUrl.toLowerCase()) ||
          (/login|sign.?in/.test(bodySnippet) && !/submit|add.*tool|description/.test(bodySnippet))) {
        throw Object.assign(new Error('Page redirected to login — this site now requires an account.'), { code: 'LOGIN_REQUIRED' });
      }
      if (/typeform is now closed|submissions?.*(closed|suspended)|free submissions?.*suspended|paid submission|paid .*submission|paid .*plan/.test(bodySnippet)) {
        throw Object.assign(new Error('Submissions appear closed or paid — this site may no longer accept free submissions.'), { code: 'PAID_WALL' });
      }
      if (/stripe\.com|checkout|payment|pricing|buy now|\$\d+/.test(bodySnippet) &&
          !/free/.test(bodySnippet)) {
        throw Object.assign(new Error('Page appears to be a payment page — this site may no longer be free.'), { code: 'PAID_WALL' });
      }

      await dismissCookieWall(page);

      // 2. Take interactive snapshot
      console.log('  🔍 Scanning form fields...');
      const { fields } = await scanFormFields(page);
      const detected = formatDetected(fields);
      console.log(`  📋 Detected: ${detected || 'none'}`);

      if (!fields.name && !fields.url && !fields.description) {
        const embedded = await detectEmbeddedForm(page);
        if (embedded) {
          throw Object.assign(new Error(`${embedded} form detected in iframe — generic adapter cannot fill cross-frame forms. Use a form-specific adapter or direct form URL.`), { code: 'IFRAME_FORM' });
        }
        throw Object.assign(new Error('No recognizable form fields found. Use scout first.'), { code: 'NO_FIELDS' });
      }

      // 3. Fill detected fields
      if (fields.name) {
        console.log(`  ✏️  Filling name: ${product.name}`);
        await page.fill(fields.name, product.name);
        await delay(300);
      }

      if (fields.url) {
        const url = product.utm_url || product.url;
        console.log(`  ✏️  Filling URL: ${url}`);
        await page.fill(fields.url, url);
        await delay(300);
      }

      if (fields.email) {
        console.log(`  ✏️  Filling email: ${product.email}`);
        await page.fill(fields.email, product.email);
        await delay(300);
      }

      if (fields.description) {
        const desc = product.submit_text || product.long_description || product.description;
        console.log(`  ✏️  Filling description`);
        await page.fill(fields.description, desc);
        await delay(300);
      }

      // 4. Screenshot before submit — named {hostname}-{YYYY-MM-DD}.png so
      //    same-site same-day screenshots overwrite instead of piling up.
      try {
        const screenshotDir = config.browser?.screenshot_dir || './screenshots';
        const hostname = new URL(targetUrl).hostname.replace(/^www\./, '');
        const date = new Date().toISOString().slice(0, 10);
        await page.screenshot(`${screenshotDir}/${hostname}-${date}.png`);
      } catch {}

      // 5. Submit — prefer snapshot button ref, fall back to CSS selector
      if (fields.submit) {
        console.log(`  🚀 Clicking submit (${fields.submit})`);
        await page.click(fields.submit);
        await delay(3000);
      } else {
        // Try CSS selectors for common form submit buttons
        const submitSelectors = [
          'input[type=submit]',
          'button[type=submit]',
          'form button:last-of-type',
        ];
        let clicked = false;
        for (const sel of submitSelectors) {
          try {
            await page.evalClickReal(sel);
            console.log(`  🚀 Clicked submit via CSS: ${sel}`);
            await delay(3000);
            clicked = true;
            break;
          } catch {}
        }
        if (!clicked) console.log('  ⚠️  No submit button found — form filled but not submitted');
      }

      const currentUrl = page.url();
      return {
        url: currentUrl,
        confirmation: fields.submit
          ? 'Generic submission completed — verify manually'
          : 'Form filled but no submit button found',
      };
    });
  },
};
