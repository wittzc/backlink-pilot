// sites/futuretools.js — futuretools.io adapter
// Auth: None. CAPTCHA: Cloudflare Turnstile (since 2026-04) → triage marks
// this site as manual-review (captcha-required). The recipe path still fills
// every other field; a human solves the Turnstile then clicks submit.
//
// Routing:
//   - Default: load recipes/futuretools.yaml and run via form-recipe runtime.
//   - Fallback (BACKLINK_RECIPE_DISABLE=1 or recipe missing): use the legacy
//     hand-written submit path preserved below as `submitLegacy`.
//
// The two helpers `futureToolsCategory` / `futureToolsPricing` are kept
// exported so existing tests (and any external callers) continue to pass.

import { withBrowser, delay } from '../browser.js';
import { loadRecipes } from './recipe-loader.js';
import { runRecipe } from './form-recipe.js';
import { createBbRecipePage } from './bb-recipe-page.js';

const SITE_KEY = 'futuretools';
const SUBMIT_URL = 'https://www.futuretools.io/submit-a-tool';

const CATEGORY_MAP = [
  [/code|developer|programming|devtool|engineering/i, 'Generative Code'],
  [/video|animation/i, 'Generative Video'],
  [/image|art|design|photo|graphic/i, 'Generative Art'],
  [/audio|speech|voice|tts|text.?to.?speech/i, 'Text-To-Speech'],
  [/chat|assistant|bot|customer/i, 'Chat'],
];

const PRICING_VALUES = new Set(['free', 'freemium', 'paid', 'open_source']);

let _recipeCache = null;
let _recipeCacheLoaded = false;

function loadRecipeOnce() {
  if (_recipeCacheLoaded) return _recipeCache;
  try {
    const all = loadRecipes('recipes');
    _recipeCache = all[SITE_KEY] || null;
  } catch {
    _recipeCache = null;
  }
  _recipeCacheLoaded = true;
  return _recipeCache;
}

/** Test hook — clears the lazy recipe cache so env-var branches are testable. */
export function _resetRecipeCacheForTests() {
  _recipeCache = null;
  _recipeCacheLoaded = false;
}

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

/** Hand-written submit — kept as the documented fallback. */
export async function submitLegacy(product, config) {
  return withBrowser({ ...config, _engine: 'bb' }, async ({ page }) => {
    console.log('  📝 Loading Future Tools submit form (legacy path)...');
    await page.goto(SUBMIT_URL);
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
}

/** Recipe-driven submit. */
export async function submitWithRecipe(product, config, recipe) {
  return withBrowser({ ...config, _engine: 'bb' }, async ({ page }) => {
    console.log('  📝 Loading Future Tools submit form (recipe path)...');
    await page.goto(recipe.url || SUBMIT_URL);
    await delay(1500);

    console.log('  ✏️  Filling Future Tools form via recipe...');
    const recipePage = createBbRecipePage(page);
    await runRecipe(recipePage, recipe, product);

    try {
      const screenshotDir = config.browser?.screenshot_dir || './screenshots';
      const date = new Date().toISOString().slice(0, 10);
      await page.screenshot(`${screenshotDir}/futuretools.io-${date}.png`);
    } catch {}

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
}

/**
 * Choose between recipe and legacy paths. Exported for unit tests so they
 * can verify the branch selection without launching a real browser.
 *
 * @returns {{ path: 'legacy'|'recipe', recipe: object|null }}
 */
export function chooseSubmitPath(env = process.env) {
  if (env.BACKLINK_RECIPE_DISABLE === '1') return { path: 'legacy', recipe: null };
  const recipe = loadRecipeOnce();
  if (!recipe) return { path: 'legacy', recipe: null };
  return { path: 'recipe', recipe };
}

export default {
  name: 'futuretools.io',
  url: SUBMIT_URL,
  auth: 'none',
  captcha: 'turnstile',
  engine: 'bb',

  async submit(product, config) {
    const choice = chooseSubmitPath();
    if (choice.path === 'recipe') {
      return submitWithRecipe(product, config, choice.recipe);
    }
    return submitLegacy(product, config);
  },
};
