import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  futureToolsCategory,
  futureToolsPricing,
  chooseSubmitPath,
  _resetRecipeCacheForTests,
} from '../src/sites/futuretools.js';

describe('futuretools adapter helpers', () => {
  it('maps product categories to Future Tools options', () => {
    assert.equal(futureToolsCategory({ categories: ['developer-tools'] }), 'Generative Code');
    assert.equal(futureToolsCategory({ categories: ['video'] }), 'Generative Video');
    assert.equal(futureToolsCategory({ categories: ['image-generation'] }), 'Generative Art');
    assert.equal(futureToolsCategory({ categories: ['audio'] }), 'Text-To-Speech');
    assert.equal(futureToolsCategory({ categories: ['unknown'] }), 'Chat');
  });

  it('maps pricing values to Future Tools radio values', () => {
    assert.equal(futureToolsPricing({ pricing: 'free' }), 'free');
    assert.equal(futureToolsPricing({ pricing: 'freemium' }), 'freemium');
    assert.equal(futureToolsPricing({ pricing: 'paid' }), 'paid');
    assert.equal(futureToolsPricing({ pricing: 'open-source' }), 'open_source');
    assert.equal(futureToolsPricing({}), 'free');
  });
});

describe('futuretools chooseSubmitPath', () => {
  beforeEach(() => _resetRecipeCacheForTests());

  it('takes the legacy branch when BACKLINK_RECIPE_DISABLE=1', () => {
    const choice = chooseSubmitPath({ BACKLINK_RECIPE_DISABLE: '1' });
    assert.equal(choice.path, 'legacy');
    assert.equal(choice.recipe, null);
  });

  it('takes the recipe branch when env unset and recipe loads', () => {
    const choice = chooseSubmitPath({});
    assert.equal(choice.path, 'recipe');
    assert.ok(choice.recipe, 'recipe should be loaded from recipes/futuretools.yaml');
    assert.equal(choice.recipe.url, 'https://www.futuretools.io/submit-a-tool');
    // Sanity: the loaded recipe carries the FT field shape from Task 3.
    assert.ok(Array.isArray(choice.recipe.fields));
    assert.ok(choice.recipe.selects?.some((s) => s.key === 'category'));
    assert.ok(choice.recipe.radios?.some((r) => r.name === 'pricing_tier'));
  });
});
