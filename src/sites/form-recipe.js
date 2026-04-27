// form-recipe.js — Runtime engine for YAML-defined form recipes.
//
// This module is browser-agnostic: it talks to a `page` interface that
// exposes a small set of high-level methods (fillSelector, selectOptionByText,
// checkRadio, checkCheckbox, clickSubmit, readSelector). Real adapters wrap
// a BbPage and translate these calls to bb-browser eval scripts; tests use
// mock objects that simply record calls.
//
// Selector escaping: recipe selectors are TRUSTED — we author every recipe
// in-repo. The runtime does NOT defensively re-escape selectors, so don't
// load recipes from untrusted sources.

/**
 * Resolve a single recipe value reference against the user's product config.
 * Pure function. Returns string|array|null. No side effects.
 *
 * Supported valueKeys:
 *   name, url, utmUrl, email, description, longDescription,
 *   categories, pricing, submitterName
 *
 * @param {object} product
 * @param {string} valueKey
 * @returns {string|string[]|null}
 */
export function resolveRecipeValue(product, valueKey) {
  if (!product || typeof product !== 'object') return null;
  switch (valueKey) {
    case 'name': return product.name ?? null;
    case 'url': return product.url ?? null;
    case 'utmUrl': return product.utm_url ?? product.url ?? null;
    case 'email': return product.email ?? null;
    case 'description': return product.description ?? null;
    case 'longDescription':
      return product.long_description ?? product.description ?? null;
    case 'categories':
      return Array.isArray(product.categories) ? product.categories : null;
    case 'pricing': return product.pricing ?? null;
    case 'submitterName':
      return product.submitter_name ?? product.name ?? null;
    case 'twitter': return product.twitter ?? null;
    case 'github': return product.github_url ?? null;
    case 'logo': return product.logo_url ?? null;
    default: return null;
  }
}

/**
 * Resolve a select control's chosen option label by mapping the resolved
 * source value through `select.map`, with `default` as the fallback key.
 *
 * For array sources (e.g. categories), the FIRST category that has a key
 * in `map` wins; if none match, `map.default` is returned.
 */
export function resolveSelectValue(product, select) {
  return _resolveMappedValue(product, select);
}

/** Same algorithm as resolveSelectValue — kept as a separate name for clarity. */
export function resolveRadioValue(product, radio) {
  return _resolveMappedValue(product, radio);
}

function _resolveMappedValue(product, def) {
  if (!def || !def.map) return null;
  const fallback = def.map.default ?? null;
  const raw = resolveRecipeValue(product, def.valueFrom);
  if (Array.isArray(raw)) {
    for (const candidate of raw) {
      if (candidate != null && Object.prototype.hasOwnProperty.call(def.map, candidate)
        && candidate !== 'default') {
        return def.map[candidate];
      }
    }
    return fallback;
  }
  if (raw != null && Object.prototype.hasOwnProperty.call(def.map, raw)
    && raw !== 'default') {
    return def.map[raw];
  }
  return fallback;
}

/**
 * Fill text-like fields. Skips fields whose value resolves to null/empty.
 */
export async function fillTextFields(page, fields, product) {
  if (!Array.isArray(fields)) return;
  for (const field of fields) {
    const val = resolveRecipeValue(product, field.value);
    if (val == null || val === '') continue;
    await page.fillSelector(field.selector, String(val));
  }
}

export async function fillSelects(page, selects, product) {
  if (!Array.isArray(selects)) return;
  for (const sel of selects) {
    const text = resolveSelectValue(product, sel);
    if (text == null) continue;
    await page.selectOptionByText(sel.selector, String(text));
  }
}

export async function fillRadios(page, radios, product) {
  if (!Array.isArray(radios)) return;
  for (const r of radios) {
    const value = resolveRadioValue(product, r);
    if (value == null) continue;
    await page.checkRadio(r.name, String(value));
  }
}

/**
 * Tick legal-consent checkboxes. The loader has already rejected anything
 * outside the {tos, privacy} whitelist, so this function trusts the recipe.
 */
export async function fillLegalCheckboxes(page, checkboxes) {
  if (!Array.isArray(checkboxes)) return;
  for (const cb of checkboxes) {
    if (cb.type !== 'tos' && cb.type !== 'privacy') continue; // belt-and-braces
    await page.checkCheckbox(cb.selector);
  }
}

/**
 * Verify that every required field's value resolves from the product config.
 * Throws with a structured message listing missing keys.
 */
export function assertRequiredFields(recipe, product) {
  const missing = [];
  for (const field of recipe.fields ?? []) {
    if (field.optional) continue;
    const val = resolveRecipeValue(product, field.value);
    if (val == null || val === '') {
      missing.push(`${field.key} (needs product.${field.value})`);
    }
  }
  if (missing.length > 0) {
    const err = new Error(
      `Recipe missing required product config: ${missing.join(', ')}`,
    );
    err.code = 'RECIPE_MISSING_FIELDS';
    err.missing = missing;
    throw err;
  }
}

/**
 * Click submit unless dryRun=true.
 */
export async function submitRecipe(page, recipe, { dryRun = false } = {}) {
  if (dryRun) return;
  if (!recipe.submit) return;
  await page.clickSubmit(recipe.submit);
}

/**
 * Read DOM values for every field/select declared in the recipe — returns
 * `{ recipeKey: domValue }` map. Used by smoke tests to verify fills landed.
 */
export async function readBackRecipeValues(page, recipe) {
  const out = {};
  for (const field of recipe.fields ?? []) {
    out[field.key] = await page.readSelector(field.selector);
  }
  for (const sel of recipe.selects ?? []) {
    out[sel.key] = await page.readSelector(sel.selector);
  }
  return out;
}

/**
 * Orchestrate the full recipe execution.
 *
 * Order: assertRequiredFields → fillTextFields → fillSelects → fillRadios →
 * fillLegalCheckboxes → submitRecipe.
 */
export async function runRecipe(page, recipe, product, opts = {}) {
  assertRequiredFields(recipe, product);
  await fillTextFields(page, recipe.fields, product);
  await fillSelects(page, recipe.selects, product);
  await fillRadios(page, recipe.radios, product);
  await fillLegalCheckboxes(page, recipe.checkboxes);
  await submitRecipe(page, recipe, opts);
}
