// sites/aivalley.js — aivalley.ai adapter
// Auth: None. CAPTCHA: None observed.
// Form type: WordPress Contact Form 7 with stable field names.
//
// Routing:
//   - Default: load recipes/aivalley.yaml and run via form-recipe runtime.
//   - Fallback (BACKLINK_RECIPE_DISABLE=1 or recipe missing): legacy
//     hand-written submit path preserved below as `submitLegacy`.

import { withBrowser, delay } from '../browser.js';
import { loadRecipes } from './recipe-loader.js';
import { runRecipe } from './form-recipe.js';
import { createBbRecipePage } from './bb-recipe-page.js';
import { isFlagOn } from '../lib/env-flag.js';

const SITE_KEY = 'aivalley';
const SUBMIT_URL = 'https://aivalley.ai/submit-tool/';

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

/** Hand-written submit — kept as the documented fallback. */
export async function submitLegacy(product, config) {
  return withBrowser({ ...config, _engine: 'bb' }, async ({ page }) => {
    console.log('  📝 Loading AI Valley submit form (legacy path)...');
    await page.goto(SUBMIT_URL);
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
}

/** Recipe-driven submit. */
export async function submitWithRecipe(product, config, recipe) {
  return withBrowser({ ...config, _engine: 'bb' }, async ({ page }) => {
    console.log('  📝 Loading AI Valley submit form (recipe path)...');
    await page.goto(recipe.url || SUBMIT_URL);
    await delay(1500);

    console.log('  ✏️  Filling AI Valley form via recipe...');
    const recipePage = createBbRecipePage(page);
    await runRecipe(recipePage, recipe, product);

    try {
      const screenshotDir = config.browser?.screenshot_dir || './screenshots';
      const date = new Date().toISOString().slice(0, 10);
      await page.screenshot(`${screenshotDir}/aivalley.ai-${date}.png`);
    } catch {}

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
}

/**
 * Choose between recipe and legacy paths. Exported for unit tests so they
 * can verify the branch selection without launching a real browser.
 */
export function chooseSubmitPath(env = process.env) {
  if (isFlagOn(env.BACKLINK_RECIPE_DISABLE)) return { path: 'legacy', recipe: null };
  const recipe = loadRecipeOnce();
  if (!recipe) return { path: 'legacy', recipe: null };
  return { path: 'recipe', recipe };
}

export default {
  name: 'aivalley.ai',
  url: SUBMIT_URL,
  auth: 'none',
  captcha: 'none',
  engine: 'bb',

  async submit(product, config, _deps = {}) {
    const {
      submitWithRecipeFn = submitWithRecipe,
      submitLegacyFn = submitLegacy,
      chooseSubmitPathFn = chooseSubmitPath,
    } = _deps;
    const choice = chooseSubmitPathFn();
    if (choice.path === 'recipe') {
      return submitWithRecipeFn(product, config, choice.recipe);
    }
    return submitLegacyFn(product, config);
  },
};
