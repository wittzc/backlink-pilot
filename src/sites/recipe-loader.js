// recipe-loader.js — Scan recipes/*.yaml, validate, return { siteKey: recipe }.
//
// This loader is the single point where recipe-schema invariants are
// enforced. The runtime in form-recipe.js trusts everything that comes out
// of here. In particular: legal checkboxes whose `type` is not in the
// {tos, privacy} whitelist are REJECTED here — there is no runtime path
// to bypass this check.

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { basename, extname, join } from 'path';
import { parseDocument } from 'yaml';

import { siteKeyFromName } from '../site-key.js';

const ALLOWED_CHECKBOX_TYPES = new Set(['tos', 'privacy']);

/**
 * Load every *.yaml file under `dir` and return a map keyed by siteKey
 * (derived from the filename via the shared siteKeyFromName helper).
 *
 * @param {string} dir Path to the recipes directory.
 * @returns {Object<string, object>} { siteKey: recipe }
 * @throws {Error} On schema violation; message includes filename + line if known.
 */
export function loadRecipes(dir) {
  if (!dir || !existsSync(dir)) return {};
  let stat;
  try { stat = statSync(dir); } catch { return {}; }
  if (!stat.isDirectory()) return {};

  const out = {};
  const files = readdirSync(dir).filter(f =>
    f.endsWith('.yaml') || f.endsWith('.yml'));

  for (const file of files) {
    const full = join(dir, file);
    const raw = readFileSync(full, 'utf-8');
    const recipe = loadRecipeFromString(raw, file);
    const siteKey = siteKeyFromName(basename(file, extname(file)));
    out[siteKey] = recipe;
  }
  return out;
}

/**
 * Parse + validate a single recipe YAML string. Exposed for testing and
 * for callers that already have YAML in memory.
 *
 * @param {string} text Raw YAML.
 * @param {string} filename Filename used in error messages.
 * @returns {object} The validated recipe (in-memory shape).
 */
export function loadRecipeFromString(text, filename) {
  const doc = parseDocument(text);
  if (doc.errors?.length) {
    throw new Error(
      `[${filename}] YAML parse error: ${doc.errors[0].message}`,
    );
  }
  const recipe = doc.toJSON();
  validateRecipe(recipe, doc, filename);
  return recipe;
}

function validateRecipe(recipe, doc, filename) {
  if (!recipe || typeof recipe !== 'object') {
    throw new Error(`[${filename}] recipe must be a YAML mapping at top level`);
  }
  if (!recipe.url || typeof recipe.url !== 'string') {
    throw new Error(
      `[${filename}] missing or invalid required field: url`,
    );
  }
  if (!Array.isArray(recipe.fields) || recipe.fields.length === 0) {
    throw new Error(
      `[${filename}] missing or invalid required field: fields (must be a non-empty list)`,
    );
  }

  for (let i = 0; i < recipe.fields.length; i++) {
    const f = recipe.fields[i];
    if (!f || !f.key || !f.selector || !f.value) {
      const line = nodeLine(doc, ['fields', i]);
      throw new Error(
        `[${filename}] fields[${i}] missing key/selector/value` +
        (line ? ` (line ${line})` : ''),
      );
    }
  }

  if (recipe.checkboxes) {
    if (!Array.isArray(recipe.checkboxes)) {
      throw new Error(
        `[${filename}] checkboxes must be a list (an array of mappings, ` +
        `each starting with "-")`,
      );
    }
    for (let i = 0; i < recipe.checkboxes.length; i++) {
      const cb = recipe.checkboxes[i];
      const line = nodeLine(doc, ['checkboxes', i]);
      const where = `checkboxes[${i}]` + (line ? ` (line ${line})` : '');
      if (!cb || typeof cb !== 'object') {
        throw new Error(`[${filename}] ${where} must be a mapping`);
      }
      if (!cb.selector) {
        throw new Error(`[${filename}] ${where} missing selector`);
      }
      if (!cb.type) {
        throw new Error(
          `[${filename}] ${where} missing type — only allowed types are: tos, privacy`,
        );
      }
      if (!ALLOWED_CHECKBOX_TYPES.has(cb.type)) {
        throw new Error(
          `[${filename}] ${where} has type=${cb.type}; ` +
          `only allowed types are: tos, privacy ` +
          `(newsletter/marketing/etc are blocked by whitelist)`,
        );
      }
    }
  }
}

/** Look up the 1-based line number of a node at `path` inside the YAML doc. */
function nodeLine(doc, path) {
  try {
    const node = doc.getIn(path, true);
    if (!node || !node.range) return null;
    const offset = node.range[0];
    // The yaml package exposes lineCounter only when constructed with one;
    // fall back to counting newlines in the source text via the document.
    const src = doc.toString();
    if (typeof offset !== 'number' || offset < 0 || offset > src.length) return null;
    let line = 1;
    for (let i = 0; i < offset; i++) {
      if (src.charCodeAt(i) === 10) line++;
    }
    return line;
  } catch {
    return null;
  }
}
