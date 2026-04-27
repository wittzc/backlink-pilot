// form-recipe.test.js — runtime + loader for YAML form recipes.
//
// These tests are pure (no real browser): page-like objects are mocks that
// record the calls made against them.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  resolveRecipeValue,
  resolveSelectValue,
  resolveRadioValue,
  fillTextFields,
  fillSelects,
  fillRadios,
  fillLegalCheckboxes,
  assertRequiredFields,
  submitRecipe,
  readBackRecipeValues,
  runRecipe,
} from '../src/sites/form-recipe.js';
import { loadRecipes, loadRecipeFromString } from '../src/sites/recipe-loader.js';

// --- Mock page ----------------------------------------------------------

function makeMockPage({ readback = {} } = {}) {
  const calls = [];
  const page = {
    calls,
    async fillSelector(sel, val) { calls.push(['fill', sel, val]); },
    async selectOptionByText(sel, text) { calls.push(['select', sel, text]); },
    async checkRadio(name, value) { calls.push(['radio', name, value]); },
    async checkCheckbox(sel) { calls.push(['checkbox', sel]); },
    async clickSubmit(sel) { calls.push(['submit', sel]); },
    async readSelector(sel) { return readback[sel] ?? ''; },
  };
  return page;
}

const SAMPLE_PRODUCT = {
  name: 'Metric Converter',
  url: 'https://metric-converter.net',
  utm_url: 'https://metric-converter.net?utm_source=ft',
  email: 'hi@metric-converter.net',
  description: 'Convert any unit, anywhere.',
  long_description: 'A small utility for unit conversion across SI and imperial.',
  categories: ['developer-tools', 'productivity'],
  pricing: 'free',
  submitter_name: 'Alice',
};

// --- resolveRecipeValue -------------------------------------------------

describe('resolveRecipeValue', () => {
  it('resolves name from product.name', () => {
    assert.equal(resolveRecipeValue(SAMPLE_PRODUCT, 'name'), 'Metric Converter');
  });

  it('resolves url from product.url', () => {
    assert.equal(resolveRecipeValue(SAMPLE_PRODUCT, 'url'), 'https://metric-converter.net');
  });

  it('resolves utmUrl preferring product.utm_url then falling back to url', () => {
    assert.equal(resolveRecipeValue(SAMPLE_PRODUCT, 'utmUrl'),
      'https://metric-converter.net?utm_source=ft');
    assert.equal(
      resolveRecipeValue({ url: 'https://x.com' }, 'utmUrl'),
      'https://x.com'
    );
  });

  it('resolves email from product.email', () => {
    assert.equal(resolveRecipeValue(SAMPLE_PRODUCT, 'email'), 'hi@metric-converter.net');
  });

  it('resolves description from product.description', () => {
    assert.equal(resolveRecipeValue(SAMPLE_PRODUCT, 'description'),
      'Convert any unit, anywhere.');
  });

  it('resolves longDescription falling back to description', () => {
    assert.equal(
      resolveRecipeValue(SAMPLE_PRODUCT, 'longDescription'),
      'A small utility for unit conversion across SI and imperial.',
    );
    assert.equal(
      resolveRecipeValue({ description: 'short' }, 'longDescription'),
      'short',
    );
  });

  it('resolves categories as the raw array', () => {
    assert.deepEqual(resolveRecipeValue(SAMPLE_PRODUCT, 'categories'),
      ['developer-tools', 'productivity']);
  });

  it('resolves pricing from product.pricing', () => {
    assert.equal(resolveRecipeValue(SAMPLE_PRODUCT, 'pricing'), 'free');
  });

  it('resolves submitterName preferring product.submitter_name then product.name', () => {
    assert.equal(resolveRecipeValue(SAMPLE_PRODUCT, 'submitterName'), 'Alice');
    assert.equal(
      resolveRecipeValue({ name: 'Bob' }, 'submitterName'),
      'Bob',
    );
  });

  it('returns null for unknown valueKey', () => {
    assert.equal(resolveRecipeValue(SAMPLE_PRODUCT, 'totallyUnknown'), null);
  });
});

// --- select / radio mapping --------------------------------------------

describe('resolveSelectValue and resolveRadioValue', () => {
  const select = {
    valueFrom: 'categories',
    map: { video: 'Generative Video', 'developer-tools': 'Generative Code', default: 'Chat' },
  };

  it('maps first matching category through select.map', () => {
    assert.equal(resolveSelectValue(SAMPLE_PRODUCT, select), 'Generative Code');
  });

  it('falls back to default when no category matches', () => {
    assert.equal(
      resolveSelectValue({ categories: ['unknown', 'misc'] }, select),
      'Chat',
    );
  });

  it('falls back to default when categories is empty/missing', () => {
    assert.equal(resolveSelectValue({}, select), 'Chat');
    assert.equal(resolveSelectValue({ categories: [] }, select), 'Chat');
  });

  it('maps a scalar value (pricing) through radio.map with default fallback', () => {
    const radio = {
      valueFrom: 'pricing',
      map: { free: 'free', freemium: 'freemium', 'open-source': 'open_source', default: 'free' },
    };
    assert.equal(resolveRadioValue({ pricing: 'open-source' }, radio), 'open_source');
    assert.equal(resolveRadioValue({ pricing: 'enterprise' }, radio), 'free');
    assert.equal(resolveRadioValue({}, radio), 'free');
  });

  it('returns null when no map default is provided and no match', () => {
    const radio = { valueFrom: 'pricing', map: { free: 'free' } };
    assert.equal(resolveRadioValue({ pricing: 'paid' }, radio), null);
  });
});

// --- fill helpers -------------------------------------------------------

describe('fill helpers', () => {
  it('fillTextFields calls page.fillSelector for each entry that resolves', async () => {
    const page = makeMockPage();
    await fillTextFields(page, [
      { key: 'name', selector: 'input[name="n"]', value: 'name' },
      { key: 'email', selector: 'input[name="e"]', value: 'email' },
    ], SAMPLE_PRODUCT);
    assert.deepEqual(page.calls, [
      ['fill', 'input[name="n"]', 'Metric Converter'],
      ['fill', 'input[name="e"]', 'hi@metric-converter.net'],
    ]);
  });

  it('fillTextFields skips entries whose value resolves to null', async () => {
    const page = makeMockPage();
    await fillTextFields(page, [
      { key: 'mystery', selector: 'input[name="m"]', value: 'totallyUnknown' },
    ], SAMPLE_PRODUCT);
    assert.deepEqual(page.calls, []);
  });

  it('fillSelects uses select.map and selectOptionByText', async () => {
    const page = makeMockPage();
    await fillSelects(page, [{
      key: 'category',
      selector: 'select[name="c"]',
      valueFrom: 'categories',
      map: { 'developer-tools': 'Generative Code', default: 'Chat' },
    }], SAMPLE_PRODUCT);
    assert.deepEqual(page.calls, [['select', 'select[name="c"]', 'Generative Code']]);
  });

  it('fillRadios uses radio.map and checkRadio', async () => {
    const page = makeMockPage();
    await fillRadios(page, [{
      key: 'pricing_tier',
      name: 'pricing_tier',
      valueFrom: 'pricing',
      map: { free: 'free', default: 'free' },
    }], SAMPLE_PRODUCT);
    assert.deepEqual(page.calls, [['radio', 'pricing_tier', 'free']]);
  });

  it('fillLegalCheckboxes ticks tos and privacy entries', async () => {
    const page = makeMockPage();
    await fillLegalCheckboxes(page, [
      { key: 'agree_tos', type: 'tos', selector: 'input[name="tos"]' },
      { key: 'agree_priv', type: 'privacy', selector: 'input[name="priv"]' },
    ]);
    assert.deepEqual(page.calls, [
      ['checkbox', 'input[name="tos"]'],
      ['checkbox', 'input[name="priv"]'],
    ]);
  });
});

// --- assertRequiredFields ----------------------------------------------

describe('assertRequiredFields', () => {
  it('throws when a required value is missing from product config', () => {
    const recipe = {
      url: 'https://x',
      fields: [
        { key: 'email', selector: 'input', value: 'email' },
        { key: 'name', selector: 'input', value: 'name' },
      ],
    };
    assert.throws(
      () => assertRequiredFields(recipe, { name: 'X' }),
      /missing.*email/i,
    );
  });

  it('passes when all required values resolve', () => {
    const recipe = {
      url: 'https://x',
      fields: [{ key: 'name', selector: 'input', value: 'name' }],
    };
    assert.doesNotThrow(() => assertRequiredFields(recipe, { name: 'X' }));
  });

  it('skips fields explicitly marked optional', () => {
    const recipe = {
      url: 'https://x',
      fields: [
        { key: 'name', selector: 'input', value: 'name' },
        { key: 'twitter', selector: 'input', value: 'twitter', optional: true },
      ],
    };
    assert.doesNotThrow(() => assertRequiredFields(recipe, { name: 'X' }));
  });
});

// --- submitRecipe + dryRun ---------------------------------------------

describe('submitRecipe dryRun discipline', () => {
  it('does NOT click submit when dryRun=true', async () => {
    const page = makeMockPage();
    await submitRecipe(page, { submit: 'button[type="submit"]' }, { dryRun: true });
    assert.equal(page.calls.length, 0,
      'dryRun must not click submit; calls were: ' + JSON.stringify(page.calls));
  });

  it('clicks submit selector when dryRun=false', async () => {
    const page = makeMockPage();
    await submitRecipe(page, { submit: 'button[type="submit"]' }, { dryRun: false });
    assert.deepEqual(page.calls, [['submit', 'button[type="submit"]']]);
  });
});

// --- readBackRecipeValues ----------------------------------------------

describe('readBackRecipeValues', () => {
  it('returns DOM values keyed by recipe field key', async () => {
    const recipe = {
      fields: [
        { key: 'name', selector: 'input[name="n"]', value: 'name' },
        { key: 'email', selector: 'input[name="e"]', value: 'email' },
      ],
      selects: [{ key: 'cat', selector: 'select[name="c"]', valueFrom: 'categories', map: {} }],
    };
    const page = makeMockPage({
      readback: {
        'input[name="n"]': 'Metric Converter',
        'input[name="e"]': 'hi@metric-converter.net',
        'select[name="c"]': 'Generative Code',
      },
    });
    const out = await readBackRecipeValues(page, recipe);
    assert.deepEqual(out, {
      name: 'Metric Converter',
      email: 'hi@metric-converter.net',
      cat: 'Generative Code',
    });
  });
});

// --- runRecipe orchestration ------------------------------------------

describe('runRecipe', () => {
  it('orchestrates fills then optionally submits', async () => {
    const page = makeMockPage();
    const recipe = {
      url: 'https://x',
      fields: [{ key: 'name', selector: 'input[name="n"]', value: 'name' }],
      selects: [{
        key: 'cat', selector: 'select[name="c"]', valueFrom: 'categories',
        map: { 'developer-tools': 'Code', default: 'Other' },
      }],
      radios: [{
        key: 'pricing_tier', name: 'pricing_tier', valueFrom: 'pricing',
        map: { free: 'free', default: 'free' },
      }],
      checkboxes: [{ key: 'tos', type: 'tos', selector: 'input[name="tos"]' }],
      submit: 'button[type="submit"]',
    };
    await runRecipe(page, recipe, SAMPLE_PRODUCT, { dryRun: true });

    // dryRun → all fills happened, no submit
    assert.deepEqual(page.calls, [
      ['fill', 'input[name="n"]', 'Metric Converter'],
      ['select', 'select[name="c"]', 'Code'],
      ['radio', 'pricing_tier', 'free'],
      ['checkbox', 'input[name="tos"]'],
    ]);
  });

  it('clicks submit when dryRun=false', async () => {
    const page = makeMockPage();
    const recipe = {
      url: 'https://x',
      fields: [{ key: 'name', selector: 'input[name="n"]', value: 'name' }],
      submit: 'button[type="submit"]',
    };
    await runRecipe(page, recipe, SAMPLE_PRODUCT, { dryRun: false });
    assert.deepEqual(page.calls, [
      ['fill', 'input[name="n"]', 'Metric Converter'],
      ['submit', 'button[type="submit"]'],
    ]);
  });
});

// --- recipe-loader -----------------------------------------------------

describe('recipe-loader', () => {
  function tmpRecipesDir() {
    const dir = mkdtempSync(join(tmpdir(), 'recipes-test-'));
    return dir;
  }

  it('parses a valid YAML recipe and indexes by siteKey from filename', () => {
    const dir = tmpRecipesDir();
    try {
      writeFileSync(join(dir, 'futuretools.yaml'), [
        'url: https://www.futuretools.io/submit-a-tool',
        'fields:',
        '  - key: name',
        '    selector: input[name="tool_name"]',
        '    value: name',
        'submit: button[type="submit"]',
        '',
      ].join('\n'));
      const map = loadRecipes(dir);
      assert.ok(map.futuretools, 'expected futuretools key');
      assert.equal(map.futuretools.url, 'https://www.futuretools.io/submit-a-tool');
      assert.equal(map.futuretools.fields[0].key, 'name');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty map when directory has no recipes', () => {
    const dir = tmpRecipesDir();
    try {
      writeFileSync(join(dir, '.gitkeep'), '');
      const map = loadRecipes(dir);
      assert.deepEqual(map, {});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty map when directory does not exist', () => {
    const map = loadRecipes('/nonexistent/path/that/should/not/exist/12345');
    assert.deepEqual(map, {});
  });

  it('rejects recipe missing required `url` field with filename in error', () => {
    const dir = tmpRecipesDir();
    try {
      const file = join(dir, 'bad.yaml');
      writeFileSync(file, [
        'fields:',
        '  - key: name',
        '    selector: input',
        '    value: name',
        '',
      ].join('\n'));
      assert.throws(
        () => loadRecipes(dir),
        (err) => /bad\.yaml/.test(err.message) && /url/.test(err.message),
        'error must mention filename + missing field',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects recipe missing required `fields` field with filename in error', () => {
    const dir = tmpRecipesDir();
    try {
      writeFileSync(join(dir, 'nofields.yaml'),
        'url: https://x.com/submit\n');
      assert.throws(
        () => loadRecipes(dir),
        (err) => /nofields\.yaml/.test(err.message) && /fields/.test(err.message),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects checkbox with type=newsletter with filename + entry in error', () => {
    const dir = tmpRecipesDir();
    try {
      writeFileSync(join(dir, 'spammy.yaml'), [
        'url: https://x.com/submit',
        'fields:',
        '  - key: name',
        '    selector: input',
        '    value: name',
        'checkboxes:',
        '  - key: subscribe',
        '    type: newsletter',
        '    selector: input[name="subscribe"]',
        '',
      ].join('\n'));
      assert.throws(
        () => loadRecipes(dir),
        (err) =>
          /spammy\.yaml/.test(err.message) &&
          /newsletter/.test(err.message) &&
          /tos|privacy|whitelist|allowed/i.test(err.message),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects checkbox with type=marketing', () => {
    const dir = tmpRecipesDir();
    try {
      writeFileSync(join(dir, 'mkt.yaml'), [
        'url: https://x.com/submit',
        'fields:',
        '  - key: name',
        '    selector: input',
        '    value: name',
        'checkboxes:',
        '  - key: opt',
        '    type: marketing',
        '    selector: input',
        '',
      ].join('\n'));
      assert.throws(() => loadRecipes(dir), /marketing/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects checkbox with no type field', () => {
    const dir = tmpRecipesDir();
    try {
      writeFileSync(join(dir, 'notype.yaml'), [
        'url: https://x.com/submit',
        'fields:',
        '  - key: name',
        '    selector: input',
        '    value: name',
        'checkboxes:',
        '  - key: foo',
        '    selector: input',
        '',
      ].join('\n'));
      assert.throws(() => loadRecipes(dir), /type/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts checkbox with type=tos and type=privacy', () => {
    const dir = tmpRecipesDir();
    try {
      writeFileSync(join(dir, 'good.yaml'), [
        'url: https://x.com/submit',
        'fields:',
        '  - key: name',
        '    selector: input',
        '    value: name',
        'checkboxes:',
        '  - key: tos',
        '    type: tos',
        '    selector: input[name="tos"]',
        '  - key: priv',
        '    type: privacy',
        '    selector: input[name="priv"]',
        '',
      ].join('\n'));
      const map = loadRecipes(dir);
      assert.equal(map.good.checkboxes.length, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('error message includes a line number when YAML node has location info', () => {
    // Use loadRecipeFromString to control content + filename
    const yaml = [
      'url: https://x.com/submit',
      'fields:',
      '  - key: name',
      '    selector: input',
      '    value: name',
      'checkboxes:',
      '  - key: bad',
      '    type: newsletter',
      '    selector: input',
      '',
    ].join('\n');
    assert.throws(
      () => loadRecipeFromString(yaml, 'spammy.yaml'),
      (err) => /spammy\.yaml/.test(err.message) && /line\s*\d+/i.test(err.message),
    );
  });
});
