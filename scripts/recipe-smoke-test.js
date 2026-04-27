#!/usr/bin/env node
// recipe-smoke-test.js — Open a recipe site in bb-browser, run the recipe in
// dryRun mode, then read DOM values back. NEVER clicks submit.
//
// Usage:
//   node scripts/recipe-smoke-test.js <siteKey>
//
// Example:
//   bb-browser open about:blank
//   node scripts/recipe-smoke-test.js futuretools
//   node scripts/recipe-smoke-test.js aivalley
//
// Requirements:
//   - Chrome reachable via bb-browser (run `bb-browser open about:blank` first).
//   - config.yaml present in cwd (same product config submit uses).
//
// Defense-in-depth: this script hard-fails if the dryRun flag passed to the
// recipe runtime is anything other than `true`. We also patch the recipe to
// remove its `submit` selector before runtime sees it, so even a buggy
// runtime cannot click submit.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { loadConfig, utmUrl } from '../src/config.js';
import { loadRecipes } from '../src/sites/recipe-loader.js';
import { runRecipe, readBackRecipeValues } from '../src/sites/form-recipe.js';
import { createBbRecipePage } from '../src/sites/bb-recipe-page.js';
import { withBrowser } from '../src/browser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RECIPES_DIR = resolve(__dirname, '..', 'recipes');

const DRY_RUN = true; // immutable contract for this script

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function main() {
  const siteKey = process.argv[2];
  if (!siteKey) fail('Usage: node scripts/recipe-smoke-test.js <siteKey>');

  if (DRY_RUN !== true) fail('DRY_RUN constant tampered with — refusing to run.');

  const config = await loadConfig();
  const recipes = loadRecipes(RECIPES_DIR);
  const recipe = recipes[siteKey];
  if (!recipe) fail(`No recipe found for siteKey=${siteKey} under recipes/`);

  // Strip submit selector so even a runtime bug cannot click submit.
  const safeRecipe = { ...recipe, submit: undefined };

  const product = {
    ...config.product,
    utm_url: utmUrl(config, siteKey),
    submitter_name: config.product.submitter_name,
  };

  console.log(`▶ Smoke test for ${siteKey}`);
  console.log(`  URL: ${recipe.url}`);
  console.log(`  dryRun: ${DRY_RUN}`);
  console.log('');

  await withBrowser({ ...config, _engine: 'bb' }, async ({ page }) => {
    console.log('  → Opening page...');
    await page.goto(recipe.url);
    await new Promise((r) => setTimeout(r, 1500));

    console.log('  → Running recipe (dryRun)...');
    const recipePage = createBbRecipePage(page);
    await runRecipe(recipePage, safeRecipe, product, { dryRun: DRY_RUN });

    console.log('  → Reading DOM values back...');
    const values = await readBackRecipeValues(recipePage, safeRecipe);

    console.log('');
    console.log('=== DOM read-back ===');
    for (const [key, val] of Object.entries(values)) {
      console.log(`  ${key}: ${JSON.stringify(val)}`);
    }
    console.log('');
    console.log('✓ Smoke test complete (no submit clicked).');
  });
}

main().catch((e) => fail(e.stack || e.message));
