// sites/futuretools.js — futuretools.io adapter
// Auth: None, CAPTCHA: None observed
// Form fields are stable native inputs/select/radios as of 2026-04-27.

import { withBrowser, delay } from '../browser.js';

const CATEGORY_MAP = [
  [/code|developer|programming|devtool|engineering/i, 'Generative Code'],
  [/video|animation/i, 'Generative Video'],
  [/image|art|design|photo|graphic/i, 'Generative Art'],
  [/audio|speech|voice|tts|text.?to.?speech/i, 'Text-To-Speech'],
  [/chat|assistant|bot|customer/i, 'Chat'],
];

const PRICING_VALUES = new Set(['free', 'freemium', 'paid', 'open_source']);

function escapeJs(str) {
  return String(str ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

export function futureToolsCategory(product) {
  const categories = [
    ...(Array.isArray(product.categories) ? product.categories : []),
    product.category,
    product.description,
  ].filter(Boolean).join(' ');

  for (const [pattern, value] of CATEGORY_MAP) {
    if (pattern.test(categories)) return value;
  }
  return 'Chat';
}

export function futureToolsPricing(product) {
  const raw = String(product.pricing || 'free').toLowerCase().replace(/-/g, '_');
  if (raw === 'opensource') return 'open_source';
  return PRICING_VALUES.has(raw) ? raw : 'free';
}

async function selectOptionByText(page, selector, text) {
  page._bb('eval', `(() => {
    const select = document.querySelector('${escapeJs(selector)}');
    if (!select) throw new Error('Missing select: ${escapeJs(selector)}');
    const option = Array.from(select.options).find(o => o.textContent.trim() === '${escapeJs(text)}');
    if (!option) throw new Error('Missing option: ${escapeJs(text)}');
    select.value = option.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

async function checkRadioValue(page, name, value) {
  page._bb('eval', `(() => {
    const input = document.querySelector('input[name="${escapeJs(name)}"][value="${escapeJs(value)}"]');
    if (!input) throw new Error('Missing radio: ${escapeJs(name)}=${escapeJs(value)}');
    input.checked = true;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.click();
  })()`);
}

export async function fillFutureToolsForm(page, product) {
  await page.locator('input[name="submitter_name"]').first().fill(product.submitter_name || product.name);
  await delay(200);
  await page.locator('input[name="tool_name"]').first().fill(product.name);
  await delay(200);
  await page.locator('input[name="tool_url"]').first().fill(product.utm_url || product.url);
  await delay(200);
  await page.locator('textarea[name="description"]').first().fill(product.description);
  await delay(200);
  await selectOptionByText(page, 'select[name="category"]', futureToolsCategory(product));
  await delay(200);
  await page.locator('input[name="submitter_email"]').first().fill(product.email);
  await delay(300);
  await checkRadioValue(page, 'pricing_tier', futureToolsPricing(product));
  await delay(200);
}

export default {
  name: 'futuretools.io',
  url: 'https://www.futuretools.io/submit-a-tool',
  auth: 'none',
  captcha: 'none',
  engine: 'bb',

  async submit(product, config) {
    return withBrowser({ ...config, _engine: 'bb' }, async ({ page }) => {
      console.log('  📝 Loading Future Tools submit form...');
      await page.goto('https://www.futuretools.io/submit-a-tool');
      await delay(1500);

      console.log('  ✏️  Filling Future Tools form...');
      await fillFutureToolsForm(page, product);

      try {
        const screenshotDir = config.browser?.screenshot_dir || './screenshots';
        const date = new Date().toISOString().slice(0, 10);
        await page.screenshot(`${screenshotDir}/futuretools.io-${date}.png`);
      } catch {}

      console.log('  🚀 Submitting Future Tools form');
      await page.locator('button[type="submit"]').first().click();
      await delay(3000);

      const body = await page.textContent('body').catch(() => '');
      const success = /thank|success|submitted|review/i.test(body);

      return {
        url: page.url(),
        confirmation: success
          ? 'Future Tools submission received'
          : 'Future Tools form submitted — verify manually',
      };
    });
  },
};
