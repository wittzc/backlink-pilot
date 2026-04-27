// sites/providers/paperform.js — First Provider Adapter (Task 4).
//
// Paperform forms are hosted at https://forms.paperform.co/<form-id> (or under
// a custom subdomain like https://aitool.paperform.co/) and embedded as
// iframes on directory pages. Cross-origin iframe contents are not reachable
// from the host page DOM, so the strategy is to navigate to the iframe URL
// directly as a top-level page, then walk the Paperform question DOM.
//
// Why not a recipe (form-recipe.js)?
//   Recipes need stable per-site selectors. Paperform-hosted forms have
//   per-form random class names, so a single recipe per Paperform site is
//   pointless. Instead, this provider adapter discovers the question
//   structure at runtime from a generic Paperform DOM contract:
//     - Each question lives inside `[data-question]` or
//       `[data-question-key]` containers.
//     - The visible label/title sits in a heading (h1/h2/h3) or
//       `.QuestionTitle__StyledTitle`/`.question-title` element.
//     - The actual input is a standard `input | textarea | select` inside.
//
// Status (Task 4): DRY-RUN ONLY. Field discovery works; map-and-fill is a
// separate task. The adapter aborts hard if `dryRun !== true` so accidental
// real-submit attempts cannot happen yet.
//
// Known limitations:
//   - Multi-page Paperforms ("next" buttons): only the first visible page is
//     discovered. Future iteration: walk pages by clicking next + re-reading.
//   - CAPTCHA (Turnstile/reCAPTCHA inside the Paperform): smoke script
//     detects + aborts; the adapter itself is dry-run so it never trips.

export const PAPERFORM_DOMAIN_RE = /(^|\.)paperform\.co(\/|$)/i;

/**
 * @returns {boolean} true if the URL points at a Paperform-hosted form.
 */
export function isPaperformUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return PAPERFORM_DOMAIN_RE.test(u.host);
  } catch {
    // Not a parseable URL — fall back to substring check (e.g. raw fragments).
    return /paperform\.co/i.test(url);
  }
}

/**
 * Walk a parsed Paperform DOM (jsdom-like Document, or a duck-typed object
 * with .querySelectorAll returning elements that expose .querySelector,
 * .querySelectorAll, .textContent, .getAttribute, .tagName, .type, .name)
 * and return the discovered question fields.
 *
 * Pure function. Does NOT take a string — callers parse HTML first
 * (Node 22+ has no built-in DOM, so production callers will use the eval'd
 * page DOM via bb-browser; tests pass a jsdom Document).
 *
 * @param {Document} dom A parsed DOM Document
 * @returns {{question_text: string, input_selector: string, input_type: string}[]}
 */
export function discoverPaperformFields(dom) {
  if (!dom || typeof dom.querySelectorAll !== 'function') return [];

  // Question containers: try [data-question-key] first (current Paperform
  // markup), then [data-question] (older variant), then the styled-component
  // class fallback.
  let containers = dom.querySelectorAll('[data-question-key]');
  if (!containers || containers.length === 0) {
    containers = dom.querySelectorAll('[data-question]');
  }
  if (!containers || containers.length === 0) {
    containers = dom.querySelectorAll('.Question__StyledQuestionContainer, .question');
  }

  const out = [];
  for (const container of containers) {
    const input = container.querySelector?.('input, textarea, select');
    if (!input) continue; // skip section headers / static text blocks

    const tag = String(input.tagName || '').toLowerCase();
    let inputType = tag;
    if (tag === 'input') {
      inputType = String(input.getAttribute?.('type') || input.type || 'text').toLowerCase();
    }

    // Skip Paperform's hidden internal inputs (anti-spam, page tracking, etc).
    if (inputType === 'hidden') continue;

    const questionText = extractQuestionText(container);
    const inputSelector = buildInputSelector(container, input);

    out.push({
      question_text: questionText,
      input_selector: inputSelector,
      input_type: inputType,
    });
  }
  return out;
}

function extractQuestionText(container) {
  // Preferred: explicit Paperform title classes.
  const titleEl =
    container.querySelector?.(
      '.QuestionTitle__StyledTitle, .question-title, .QuestionTitle, [data-question-title]'
    ) ||
    container.querySelector?.('h1, h2, h3, h4, label');
  const raw = titleEl?.textContent || '';
  return raw.replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim();
}

function buildInputSelector(container, input) {
  // Prefer the data-question-key based selector since it survives Paperform's
  // randomized component class names. Fall back to name attr, then id.
  const qKey = container.getAttribute?.('data-question-key');
  if (qKey) return `[data-question-key="${qKey}"] ${input.tagName.toLowerCase()}`;

  const name = input.getAttribute?.('name');
  if (name) return `${input.tagName.toLowerCase()}[name="${name}"]`;

  const id = input.getAttribute?.('id');
  if (id) return `#${id}`;

  return input.tagName.toLowerCase();
}

/**
 * Adapter entry point.
 *
 * Contract (Task 4 scope = dry-run only):
 *   - opts.dryRun MUST be `true`. Anything else throws — there is no fill
 *     code path implemented yet, and silently no-op'ing would mislead the
 *     batch executor.
 *   - opts.url is the Paperform iframe URL to open as a top-level page. The
 *     caller (batch executor or smoke script) is expected to resolve this
 *     from triage's `provider_url` field.
 *   - opts.page is an injected RecipePage-like / BbPage-like object exposing
 *     at minimum `goto(url)` + `_bb('eval', script)` (the bb-browser eval
 *     escape hatch). Tests pass a mock; production callers wrap a real
 *     BbPage. This DI lets us keep the adapter unit-testable without
 *     mocking the browser layer.
 *
 * Returns: { dryRun: true, url, fields: [...] }
 */
export async function submit(product, opts = {}) {
  const { dryRun, url, page } = opts;
  if (dryRun !== true) {
    throw new Error(
      'paperform provider: only dryRun=true is implemented (Task 4 scope). ' +
      'Real fill/submit lives in a later task; refusing to proceed.'
    );
  }
  if (!url || !isPaperformUrl(url)) {
    throw new Error(`paperform provider: invalid or non-Paperform url: ${url}`);
  }
  if (!page || typeof page.goto !== 'function' || typeof page._bb !== 'function') {
    throw new Error('paperform provider: opts.page must be a BbPage-like object');
  }

  await page.goto(url);

  // Read DOM via bb-browser eval. We construct the field list inside the
  // browser (DOM is there, not here) and serialize it back as JSON.
  const json = page._bb(
    'eval',
    `(() => {
      function pickContainers() {
        let c = document.querySelectorAll('[data-question-key]');
        if (!c.length) c = document.querySelectorAll('[data-question]');
        if (!c.length) c = document.querySelectorAll('.Question__StyledQuestionContainer, .question');
        return c;
      }
      function titleOf(container) {
        const t = container.querySelector('.QuestionTitle__StyledTitle, .question-title, .QuestionTitle, [data-question-title]')
          || container.querySelector('h1, h2, h3, h4, label');
        return (t?.textContent || '').replace(/\\s+/g, ' ').replace(/\\s*\\*\\s*$/, '').trim();
      }
      function selectorOf(container, input) {
        const qKey = container.getAttribute('data-question-key');
        if (qKey) return '[data-question-key="' + qKey + '"] ' + input.tagName.toLowerCase();
        const name = input.getAttribute('name');
        if (name) return input.tagName.toLowerCase() + '[name="' + name + '"]';
        const id = input.getAttribute('id');
        if (id) return '#' + id;
        return input.tagName.toLowerCase();
      }
      const out = [];
      for (const container of pickContainers()) {
        const input = container.querySelector('input, textarea, select');
        if (!input) continue;
        const tag = input.tagName.toLowerCase();
        let inputType = tag;
        if (tag === 'input') inputType = (input.getAttribute('type') || 'text').toLowerCase();
        if (inputType === 'hidden') continue;
        out.push({
          question_text: titleOf(container),
          input_selector: selectorOf(container, input),
          input_type: inputType,
        });
      }
      return JSON.stringify(out);
    })()`
  );

  let fields = [];
  try {
    fields = JSON.parse(json);
  } catch {
    fields = [];
  }

  return { dryRun: true, url, fields };
}

export default {
  name: 'paperform',
  isPaperformUrl,
  discoverPaperformFields,
  submit,
};
