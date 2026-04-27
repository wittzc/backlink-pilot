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
 * @typedef {object} RecipePage
 * Selectors are CSS strings, optionally suffixed with `|nth=N` to address
 * the Nth match (0-indexed). Implementations should split on `|nth=` and
 * use querySelectorAll[N]. Required for forms with duplicate selectors
 * (e.g., WPCF7 with two textareas named the same).
 * @property {(selector: string, value: string) => Promise<void>} fillSelector
 * @property {(selector: string, text: string) => Promise<void>} selectOptionByText
 * @property {(name: string, value: string) => Promise<void>} checkRadio
 * @property {(selector: string) => Promise<void>} checkCheckbox
 * @property {(selector: string) => Promise<void>} clickSubmit
 * @property {(selector: string) => Promise<string>} readSelector
 */

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
 *
 * @param {RecipePage} page
 * @param {Array<object>} fields
 * @param {object} product
 */
export async function fillTextFields(page, fields, product) {
  if (!Array.isArray(fields)) return;
  for (const field of fields) {
    const val = resolveRecipeValue(product, field.value);
    if (val == null || val === '') continue;
    await page.fillSelector(field.selector, String(val));
  }
}

/**
 * @param {RecipePage} page
 * @param {Array<object>} selects
 * @param {object} product
 */
export async function fillSelects(page, selects, product) {
  if (!Array.isArray(selects)) return;
  for (const sel of selects) {
    const text = resolveSelectValue(product, sel);
    if (text == null) continue;
    await page.selectOptionByText(sel.selector, String(text));
  }
}

/**
 * @param {RecipePage} page
 * @param {Array<object>} radios
 * @param {object} product
 */
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
 *
 * @param {RecipePage} page
 * @param {Array<object>} checkboxes
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
  // Selects/radios with a `map.default` are always satisfiable, so we only
  // flag those WITHOUT a default that cannot resolve any source value.
  for (const sel of recipe.selects ?? []) {
    if (sel.optional) continue;
    const hasDefault = sel.map && Object.prototype.hasOwnProperty.call(sel.map, 'default')
      && sel.map.default != null;
    if (hasDefault) continue;
    const resolved = _resolveMappedValue(product, sel);
    if (resolved == null) {
      missing.push(`${sel.key} (needs product.${sel.valueFrom} or recipe map.default)`);
    }
  }
  for (const r of recipe.radios ?? []) {
    if (r.optional) continue;
    const hasDefault = r.map && Object.prototype.hasOwnProperty.call(r.map, 'default')
      && r.map.default != null;
    if (hasDefault) continue;
    const resolved = _resolveMappedValue(product, r);
    if (resolved == null) {
      missing.push(`${r.key} (needs product.${r.valueFrom} or recipe map.default)`);
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
 *
 * @param {RecipePage} page
 * @param {object} recipe
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function submitRecipe(page, recipe, { dryRun = false } = {}) {
  if (dryRun) return;
  if (!recipe.submit) return;
  await page.clickSubmit(recipe.submit);
}

/**
 * Read DOM values for every field/select declared in the recipe — returns
 * `{ recipeKey: domValue }` map. Used by smoke tests to verify fills landed.
 *
 * @param {RecipePage} page
 * @param {object} recipe
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
 *
 * @param {RecipePage} page
 * @param {object} recipe
 * @param {object} product
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function runRecipe(page, recipe, product, opts = {}) {
  assertRequiredFields(recipe, product);
  await fillTextFields(page, recipe.fields, product);
  await fillSelects(page, recipe.selects, product);
  await fillRadios(page, recipe.radios, product);
  await fillLegalCheckboxes(page, recipe.checkboxes);
  await submitRecipe(page, recipe, opts);
}
