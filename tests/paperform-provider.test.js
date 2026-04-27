// paperform-provider.test.js — Unit tests for the Paperform provider adapter.
//
// No real browser, no jsdom (we have zero new deps allowed). Instead we build
// a minimal duck-typed DOM mock that satisfies the methods discoverPaperformFields
// actually calls. This keeps the test fast and traceable.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PAPERFORM_DOMAIN_RE,
  isPaperformUrl,
  discoverPaperformFields,
  submit,
} from '../src/sites/providers/paperform.js';

// ----------------------------------------------------------------------------
// Tiny DOM mock — only the surface area discoverPaperformFields uses.
// Element shape:
//   { tagName, attrs: {}, type, textContent, children: [Element] }
// ----------------------------------------------------------------------------

function el(tagName, attrs = {}, children = [], textContent = '') {
  const node = {
    tagName: tagName.toUpperCase(),
    _attrs: { ...attrs },
    type: attrs.type,
    name: attrs.name,
    children,
    _text: textContent,
  };
  node.getAttribute = (k) => (k in node._attrs ? node._attrs[k] : null);
  Object.defineProperty(node, 'textContent', {
    get() {
      if (node._text) return node._text;
      return node.children.map((c) => c.textContent || '').join(' ');
    },
  });
  // querySelector / querySelectorAll: super-simple matcher honoring only what
  // discoverPaperformFields actually uses:
  //   - tag list ("input, textarea, select")
  //   - "[data-question-key]" / "[data-question]"
  //   - class selectors (".QuestionTitle__StyledTitle, ...")
  //   - heading list ("h1, h2, h3, h4, label")
  node.querySelector = (sel) => firstMatch(node, sel);
  node.querySelectorAll = (sel) => allMatches(node, sel);
  return node;
}

function matches(node, simpleSel) {
  const s = simpleSel.trim();
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1);
    if (inner.includes('=')) {
      const [k, vRaw] = inner.split('=');
      const v = vRaw.replace(/^["']|["']$/g, '');
      return node.getAttribute(k) === v;
    }
    return node.getAttribute(inner) !== null;
  }
  if (s.startsWith('.')) {
    const cls = s.slice(1);
    const cv = node.getAttribute('class') || '';
    return cv.split(/\s+/).includes(cls);
  }
  return node.tagName === s.toUpperCase();
}

function matchesAny(node, selector) {
  return selector.split(',').some((part) => matches(node, part));
}

function* walk(node) {
  for (const child of node.children) {
    yield child;
    yield* walk(child);
  }
}

function firstMatch(root, selector) {
  for (const n of walk(root)) {
    if (matchesAny(n, selector)) return n;
  }
  return null;
}

function allMatches(root, selector) {
  const out = [];
  for (const n of walk(root)) {
    if (matchesAny(n, selector)) out.push(n);
  }
  return out;
}

// ----------------------------------------------------------------------------

describe('paperform — isPaperformUrl', () => {
  it('matches the canonical forms.paperform.co host', () => {
    assert.equal(isPaperformUrl('https://forms.paperform.co/abc123'), true);
  });

  it('matches custom Paperform subdomains (e.g. aitool.paperform.co)', () => {
    assert.equal(isPaperformUrl('https://aitool.paperform.co/?embed=1'), true);
  });

  it('rejects unrelated form hosts (Tally, Typeform, Airtable)', () => {
    assert.equal(isPaperformUrl('https://tally.so/embed/abc'), false);
    assert.equal(isPaperformUrl('https://form.typeform.com/to/x'), false);
    assert.equal(isPaperformUrl('https://airtable.com/embed/x'), false);
  });

  it('rejects empty / non-string input', () => {
    assert.equal(isPaperformUrl(''), false);
    assert.equal(isPaperformUrl(null), false);
    assert.equal(isPaperformUrl(undefined), false);
    assert.equal(isPaperformUrl(123), false);
  });

  it('PAPERFORM_DOMAIN_RE accepts both forms.* and custom subdomains', () => {
    assert.match('forms.paperform.co', PAPERFORM_DOMAIN_RE);
    assert.match('aitool.paperform.co', PAPERFORM_DOMAIN_RE);
    assert.doesNotMatch('paperform.io', PAPERFORM_DOMAIN_RE);
  });
});

describe('paperform — discoverPaperformFields', () => {
  it('returns [] for empty / invalid dom input', () => {
    assert.deepEqual(discoverPaperformFields(null), []);
    assert.deepEqual(discoverPaperformFields({}), []);
  });

  it('extracts question text + selector + type for input/textarea/select', () => {
    const dom = el('div', {}, [
      el('div', { 'data-question-key': 'q1' }, [
        el('h3', { class: 'QuestionTitle__StyledTitle' }, [], 'Tool Name *'),
        el('input', { type: 'text', name: 'tool_name' }),
      ]),
      el('div', { 'data-question-key': 'q2' }, [
        el('h3', { class: 'QuestionTitle__StyledTitle' }, [], 'Description'),
        el('textarea', { name: 'desc' }),
      ]),
      el('div', { 'data-question-key': 'q3' }, [
        el('h3', { class: 'QuestionTitle__StyledTitle' }, [], 'Email'),
        el('input', { type: 'email', name: 'submitter_email' }),
      ]),
      el('div', { 'data-question-key': 'q4' }, [
        el('h3', { class: 'QuestionTitle__StyledTitle' }, [], 'Pricing'),
        el('select', { name: 'pricing' }),
      ]),
    ]);

    const fields = discoverPaperformFields(dom);

    assert.equal(fields.length, 4);
    assert.deepEqual(fields[0], {
      question_text: 'Tool Name',
      input_selector: '[data-question-key="q1"] input',
      input_type: 'text',
    });
    assert.equal(fields[1].input_type, 'textarea');
    assert.equal(fields[2].input_type, 'email');
    assert.equal(fields[3].input_type, 'select');
  });

  it('skips containers with only static text (no input)', () => {
    const dom = el('div', {}, [
      el('div', { 'data-question-key': 'intro' }, [
        el('h3', {}, [], 'Welcome to our directory'),
      ]),
      el('div', { 'data-question-key': 'q1' }, [
        el('h3', {}, [], 'URL'),
        el('input', { type: 'url', name: 'url' }),
      ]),
    ]);
    const fields = discoverPaperformFields(dom);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].input_type, 'url');
  });

  it('skips hidden inputs (Paperform anti-spam / page-tracking)', () => {
    const dom = el('div', {}, [
      el('div', { 'data-question-key': 'h' }, [
        el('input', { type: 'hidden', name: '_token' }),
      ]),
      el('div', { 'data-question-key': 'q1' }, [
        el('h3', {}, [], 'Email'),
        el('input', { type: 'email', name: 'email' }),
      ]),
    ]);
    const fields = discoverPaperformFields(dom);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].question_text, 'Email');
  });

  it('falls back to [data-question] then to .Question__StyledQuestionContainer', () => {
    const dom1 = el('div', {}, [
      el('div', { 'data-question': '1' }, [
        el('label', {}, [], 'Old-style label'),
        el('input', { type: 'text', name: 'foo' }),
      ]),
    ]);
    const f1 = discoverPaperformFields(dom1);
    assert.equal(f1.length, 1);
    assert.equal(f1[0].question_text, 'Old-style label');

    const dom2 = el('div', {}, [
      el('div', { class: 'Question__StyledQuestionContainer' }, [
        el('label', {}, [], 'Class-based fallback'),
        el('input', { type: 'text', name: 'bar' }),
      ]),
    ]);
    const f2 = discoverPaperformFields(dom2);
    assert.equal(f2.length, 1);
    assert.equal(f2[0].question_text, 'Class-based fallback');
    // No data-question-key → selector falls back to name attr.
    assert.equal(f2[0].input_selector, 'input[name="bar"]');
  });

  it('strips trailing required-marker asterisk from question text', () => {
    const dom = el('div', {}, [
      el('div', { 'data-question-key': 'q1' }, [
        el('h3', {}, [], 'Tool URL *'),
        el('input', { type: 'url', name: 'url' }),
      ]),
    ]);
    const fields = discoverPaperformFields(dom);
    assert.equal(fields[0].question_text, 'Tool URL');
  });
});

describe('paperform — submit() dry-run contract', () => {
  function mockBbPage(json) {
    let gotoCalledWith = null;
    let evalCalledWith = null;
    return {
      _calls: { goto: () => gotoCalledWith, eval: () => evalCalledWith },
      async goto(u) { gotoCalledWith = u; },
      _bb(verb, script) {
        if (verb !== 'eval') throw new Error(`unexpected bb verb: ${verb}`);
        evalCalledWith = script;
        return json;
      },
      get gotoCalledWith() { return gotoCalledWith; },
      get evalCalledWith() { return evalCalledWith; },
    };
  }

  it('throws when dryRun is not true (defense-in-depth — no fill code path)', async () => {
    const page = mockBbPage('[]');
    await assert.rejects(
      () => submit({}, { dryRun: false, url: 'https://forms.paperform.co/abc', page }),
      /only dryRun=true is implemented/
    );
    await assert.rejects(
      () => submit({}, { dryRun: 'true', url: 'https://forms.paperform.co/abc', page }),
      /only dryRun=true is implemented/
    );
  });

  it('throws when url is missing or non-Paperform', async () => {
    const page = mockBbPage('[]');
    await assert.rejects(
      () => submit({}, { dryRun: true, url: '', page }),
      /invalid or non-Paperform url/
    );
    await assert.rejects(
      () => submit({}, { dryRun: true, url: 'https://tally.so/embed/x', page }),
      /invalid or non-Paperform url/
    );
  });

  it('throws when page is not BbPage-like (missing goto or _bb)', async () => {
    await assert.rejects(
      () => submit({}, { dryRun: true, url: 'https://forms.paperform.co/abc', page: {} }),
      /BbPage-like/
    );
  });

  it('navigates to the iframe URL and returns parsed fields from page eval', async () => {
    const fakeFields = [
      { question_text: 'Name', input_selector: '[data-question-key="q1"] input', input_type: 'text' },
      { question_text: 'Email', input_selector: '[data-question-key="q2"] input', input_type: 'email' },
    ];
    const page = mockBbPage(JSON.stringify(fakeFields));
    const url = 'https://forms.paperform.co/abc123';

    const result = await submit({}, { dryRun: true, url, page });

    assert.equal(page.gotoCalledWith, url);
    assert.match(page.evalCalledWith, /querySelectorAll/);
    assert.deepEqual(result, { dryRun: true, url, fields: fakeFields });
  });

  it('returns fields=[] when the eval result is unparseable JSON', async () => {
    const page = mockBbPage('not-valid-json');
    const result = await submit({}, {
      dryRun: true,
      url: 'https://forms.paperform.co/x',
      page,
    });
    assert.deepEqual(result.fields, []);
  });
});
