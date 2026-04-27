// bb-recipe-page.js — Adapter that exposes a `RecipePage`-shaped object
// (see form-recipe.js typedef) backed by a BbPage from src/bb.js.
//
// The recipe runtime is browser-agnostic; this module is the only place
// that translates RecipePage method calls into bb-browser eval scripts.
//
// Special selector convention
// ---------------------------
// Selectors may carry a positional suffix: `<css>|nth=N` (zero-based).
// When present, we resolve via `document.querySelectorAll(css)[N]` instead
// of `document.querySelector(css)`. This lets recipes target the Nth
// matching element without inventing brittle compound selectors (used by
// AI Valley's two `textarea[name="your-message"]` fields).
//
// Selector trust
// --------------
// Recipes are author-trusted (loader rejects untyped checkboxes; YAML
// itself is in-repo). We escape values destined for string literals
// inside eval scripts but do NOT defensively rewrite selectors.

function escapeJs(str) {
  return String(str ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n');
}

/**
 * Parse `selector|nth=N` → `{ css, index }`. Returns `{ css, index: null }`
 * for plain selectors.
 */
export function parseSelector(selector) {
  const m = String(selector ?? '').match(/^(.*?)\|nth=(\d+)$/);
  if (!m) return { css: String(selector ?? ''), index: null };
  return { css: m[1], index: Number(m[2]) };
}

/**
 * Build a JS expression that resolves to the target element for `selector`,
 * honoring the `|nth=N` convention. Returns a string usable inside an eval
 * IIFE (e.g. `const el = ${queryExpr(sel)};`).
 */
export function queryExpr(selector) {
  const { css, index } = parseSelector(selector);
  if (index === null) {
    return `document.querySelector('${escapeJs(css)}')`;
  }
  return `document.querySelectorAll('${escapeJs(css)}')[${index}]`;
}

/**
 * Wrap a BbPage so it satisfies the RecipePage interface used by
 * form-recipe.js. The returned object is a plain duck-typed page; tests
 * can equally well pass any object with the same six methods.
 *
 * @param {import('../bb.js').BbPage} bbPage
 * @returns {import('./form-recipe.js').RecipePage}
 */
export function createBbRecipePage(bbPage) {
  if (!bbPage || typeof bbPage._bb !== 'function') {
    throw new Error('createBbRecipePage: expected a BbPage with _bb()');
  }

  return {
    async fillSelector(selector, value) {
      const target = queryExpr(selector);
      bbPage._bb('eval', `(() => {
        const el = ${target};
        if (!el) throw new Error('Missing element: ${escapeJs(selector)}');
        el.focus();
        const proto = el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, '${escapeJs(value)}');
        else el.value = '${escapeJs(value)}';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
    },

    async selectOptionByText(selector, text) {
      const target = queryExpr(selector);
      bbPage._bb('eval', `(() => {
        const select = ${target};
        if (!select) throw new Error('Missing select: ${escapeJs(selector)}');
        const option = Array.from(select.options).find(o => o.textContent.trim() === '${escapeJs(text)}');
        if (!option) throw new Error('Missing option: ${escapeJs(text)}');
        select.value = option.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
    },

    async checkRadio(name, value) {
      bbPage._bb('eval', `(() => {
        const input = document.querySelector('input[name="${escapeJs(name)}"][value="${escapeJs(value)}"]');
        if (!input) throw new Error('Missing radio: ${escapeJs(name)}=${escapeJs(value)}');
        input.checked = true;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.click();
      })()`);
    },

    async checkCheckbox(selector) {
      const target = queryExpr(selector);
      bbPage._bb('eval', `(() => {
        const el = ${target};
        if (!el) throw new Error('Missing checkbox: ${escapeJs(selector)}');
        if (!el.checked) {
          el.checked = true;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.click();
        }
      })()`);
    },

    async clickSubmit(selector) {
      // Use the React-aware path from BbPage when the selector is plain CSS.
      const { css, index } = parseSelector(selector);
      if (index === null) {
        await bbPage.evalClickReal(css);
        return;
      }
      const target = queryExpr(selector);
      bbPage._bb('eval', `(() => {
        const el = ${target};
        if (!el) throw new Error('Missing submit: ${escapeJs(selector)}');
        el.dispatchEvent(new MouseEvent('mousedown', {bubbles:true,cancelable:true}));
        el.dispatchEvent(new MouseEvent('mouseup', {bubbles:true,cancelable:true}));
        el.dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true}));
      })()`);
    },

    async readSelector(selector) {
      const target = queryExpr(selector);
      const result = bbPage._bb('eval', `(() => {
        const el = ${target};
        if (!el) return '';
        if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
          return String(el.checked);
        }
        if ('value' in el) return String(el.value ?? '');
        return el.textContent ?? '';
      })()`);
      return result == null ? '' : String(result);
    },
  };
}
