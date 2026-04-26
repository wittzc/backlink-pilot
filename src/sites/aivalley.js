// sites/aivalley.js — aivalley.ai adapter
// Auth: None, CAPTCHA: None observed
// Form type: WordPress Contact Form 7 with stable field names.

import { withBrowser, delay } from '../browser.js';

function escapeJs(str) {
  return String(str ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

export function aiValleySubmitterName(product) {
  return product.submitter_name || product.name;
}

export function aiValleyDescriptions(product) {
  const short = product.description || product.long_description || '';
  const long = product.long_description || short;
  return { long, short };
}

async function fillTextareaByIndex(page, index, value) {
  page._bb('eval', `(() => {
    const el = document.querySelectorAll('textarea[name="your-message"]')[${index}];
    if (!el) throw new Error('Missing AI Valley textarea index ${index}');
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(el, '${escapeJs(value)}');
    else el.value = '${escapeJs(value)}';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

export async function fillAiValleyForm(page, product) {
  const descriptions = aiValleyDescriptions(product);

  await page.locator('input[name="your-name"]').first().fill(aiValleySubmitterName(product));
  await delay(200);
  await page.locator('input[name="your-email"]').first().fill(product.email);
  await delay(200);
  await page.locator('input[name="ToolName"]').first().fill(product.name);
  await delay(200);
  await page.locator('input[name="ToolURL"]').first().fill(product.utm_url || product.url);
  await delay(200);
  await fillTextareaByIndex(page, 0, descriptions.long);
  await delay(200);
  await fillTextareaByIndex(page, 1, descriptions.short);
  await delay(300);
}

export default {
  name: 'aivalley.ai',
  url: 'https://aivalley.ai/submit-tool/',
  auth: 'none',
  captcha: 'none',
  engine: 'bb',

  async submit(product, config) {
    return withBrowser({ ...config, _engine: 'bb' }, async ({ page }) => {
      console.log('  📝 Loading AI Valley submit form...');
      await page.goto('https://aivalley.ai/submit-tool/');
      await delay(1500);

      console.log('  ✏️  Filling AI Valley form...');
      await fillAiValleyForm(page, product);

      try {
        const screenshotDir = config.browser?.screenshot_dir || './screenshots';
        const date = new Date().toISOString().slice(0, 10);
        await page.screenshot(`${screenshotDir}/aivalley.ai-${date}.png`);
      } catch {}

      console.log('  🚀 Submitting AI Valley form');
      await page.locator('input[type="submit"].wpcf7-submit').first().click();
      await delay(4000);

      const body = await page.textContent('body').catch(() => '');
      const success = /thank|sent|submitted|success/i.test(body);

      return {
        url: page.url(),
        confirmation: success
          ? 'AI Valley submission received'
          : 'AI Valley form submitted — verify manually',
      };
    });
  },
};
