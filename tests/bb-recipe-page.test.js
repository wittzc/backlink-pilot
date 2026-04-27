// bb-recipe-page.test.js — Verify BbPage → RecipePage adapter delegations.
//
// We mock BbPage as an object with `_bb()` (records eval scripts) and
// `evalClickReal()` (records selector). No real bb-browser process runs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createBbRecipePage,
  parseSelector,
  queryExpr,
} from '../src/sites/bb-recipe-page.js';

function makeMockBbPage({ readback = '' } = {}) {
  const calls = [];
  return {
    calls,
    _bb(verb, payload) {
      calls.push(['_bb', verb, payload]);
      return readback;
    },
    async evalClickReal(selector) {
      calls.push(['evalClickReal', selector]);
    },
  };
}

describe('parseSelector', () => {
  it('returns plain css when no |nth= suffix', () => {
    assert.deepEqual(parseSelector('input[name="x"]'), {
      css: 'input[name="x"]',
      index: null,
    });
  });

  it('extracts the index when |nth=N is present', () => {
    assert.deepEqual(parseSelector('textarea[name="msg"]|nth=2'), {
      css: 'textarea[name="msg"]',
      index: 2,
    });
  });

  it('handles null/undefined gracefully', () => {
    assert.deepEqual(parseSelector(null), { css: '', index: null });
    assert.deepEqual(parseSelector(undefined), { css: '', index: null });
  });
});

describe('queryExpr', () => {
  it('emits querySelector for plain selectors', () => {
    assert.equal(
      queryExpr('input[name="x"]'),
      `document.querySelector('input[name="x"]')`,
    );
  });

  it('emits querySelectorAll[N] for |nth=N selectors', () => {
    assert.equal(
      queryExpr('textarea[name="msg"]|nth=1'),
      `document.querySelectorAll('textarea[name="msg"]')[1]`,
    );
  });

  it('escapes embedded single quotes in selectors', () => {
    // Single quotes in CSS selectors are uncommon but must be escaped to keep
    // the surrounding eval string-literal valid.
    assert.equal(
      queryExpr("[data-x='y']"),
      `document.querySelector('[data-x=\\'y\\']')`,
    );
  });
});

describe('createBbRecipePage', () => {
  it('throws if given a non-BbPage', () => {
    assert.throws(() => createBbRecipePage(null), /expected a BbPage/);
    assert.throws(() => createBbRecipePage({}), /expected a BbPage/);
  });

  it('fillSelector delegates to bbPage._bb("eval", ...) with value', async () => {
    const bb = makeMockBbPage();
    const page = createBbRecipePage(bb);
    await page.fillSelector('input[name="email"]', 'a@b.com');

    assert.equal(bb.calls.length, 1);
    const [verb, op, script] = bb.calls[0];
    assert.equal(verb, '_bb');
    assert.equal(op, 'eval');
    assert.match(script, /document\.querySelector\('input\[name="email"\]'\)/);
    assert.match(script, /a@b\.com/);
    // Must use the React-friendly setter path.
    assert.match(script, /Object\.getOwnPropertyDescriptor\(proto, 'value'\)/);
  });

  it('fillSelector escapes single quotes inside values', async () => {
    const bb = makeMockBbPage();
    const page = createBbRecipePage(bb);
    await page.fillSelector('input[name="name"]', "L'Oreal");
    const script = bb.calls[0][2];
    assert.match(script, /L\\'Oreal/);
  });

  it('fillSelector resolves |nth=N selectors via querySelectorAll', async () => {
    const bb = makeMockBbPage();
    const page = createBbRecipePage(bb);
    await page.fillSelector('textarea[name="msg"]|nth=1', 'hi');
    const script = bb.calls[0][2];
    assert.match(script, /querySelectorAll\('textarea\[name="msg"\]'\)\[1\]/);
  });

  it('selectOptionByText emits a script that matches option by trimmed text', async () => {
    const bb = makeMockBbPage();
    const page = createBbRecipePage(bb);
    await page.selectOptionByText('select[name="cat"]', 'Generative Art');
    const script = bb.calls[0][2];
    assert.match(script, /Array\.from\(select\.options\)/);
    assert.match(script, /Generative Art/);
    assert.match(script, /Missing select/);
  });

  it('checkRadio emits an input[name][value] click + change', async () => {
    const bb = makeMockBbPage();
    const page = createBbRecipePage(bb);
    await page.checkRadio('pricing_tier', 'free');
    const script = bb.calls[0][2];
    assert.match(script, /input\[name="pricing_tier"\]\[value="free"\]/);
    assert.match(script, /input\.click\(\)/);
    assert.match(script, /Missing radio/);
  });

  it('checkCheckbox only clicks if not already checked', async () => {
    const bb = makeMockBbPage();
    const page = createBbRecipePage(bb);
    await page.checkCheckbox('input#tos');
    const script = bb.calls[0][2];
    assert.match(script, /if \(!el\.checked\)/);
    assert.match(script, /el\.click\(\)/);
  });

  it('clickSubmit uses evalClickReal for plain selectors', async () => {
    const bb = makeMockBbPage();
    const page = createBbRecipePage(bb);
    await page.clickSubmit('button[type="submit"]');
    assert.equal(bb.calls.length, 1);
    assert.deepEqual(bb.calls[0], ['evalClickReal', 'button[type="submit"]']);
  });

  it('clickSubmit falls back to manual eval for |nth=N selectors', async () => {
    const bb = makeMockBbPage();
    const page = createBbRecipePage(bb);
    await page.clickSubmit('button[type="submit"]|nth=2');
    assert.equal(bb.calls.length, 1);
    const [verb, op, script] = bb.calls[0];
    assert.equal(verb, '_bb');
    assert.equal(op, 'eval');
    assert.match(script, /querySelectorAll\('button\[type="submit"\]'\)\[2\]/);
    assert.match(script, /MouseEvent\('click'/);
  });

  it('readSelector delegates and returns string', async () => {
    const bb = makeMockBbPage({ readback: 'hello' });
    const page = createBbRecipePage(bb);
    const v = await page.readSelector('input[name="x"]');
    assert.equal(v, 'hello');
    assert.equal(bb.calls.length, 1);
    const script = bb.calls[0][2];
    assert.match(script, /el\.checked/);
    assert.match(script, /\(el\.value \?\? ''\)/);
  });

  it('readSelector returns empty string when bb returns null/undefined', async () => {
    const bb1 = makeMockBbPage({ readback: null });
    assert.equal(await createBbRecipePage(bb1).readSelector('x'), '');
    const bb2 = makeMockBbPage({ readback: undefined });
    assert.equal(await createBbRecipePage(bb2).readSelector('x'), '');
  });
});
