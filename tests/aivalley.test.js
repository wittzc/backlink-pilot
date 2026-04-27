import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiValleyDescriptions,
  aiValleySubmitterName,
  chooseSubmitPath,
  _resetRecipeCacheForTests,
} from '../src/sites/aivalley.js';

describe('aivalley adapter helpers', () => {
  it('uses product name as submitter fallback', () => {
    assert.equal(aiValleySubmitterName({ name: 'My App' }), 'My App');
    assert.equal(aiValleySubmitterName({ name: 'My App', submitter_name: 'Jane Doe' }), 'Jane Doe');
  });

  it('builds long and short descriptions for the two Contact Form 7 textareas', () => {
    const descriptions = aiValleyDescriptions({
      description: 'Short description',
      long_description: 'Long description',
    });

    assert.deepEqual(descriptions, {
      long: 'Long description',
      short: 'Short description',
    });
  });

  it('falls back to short description when long description is missing', () => {
    assert.deepEqual(aiValleyDescriptions({ description: 'Only description' }), {
      long: 'Only description',
      short: 'Only description',
    });
  });
});

describe('aivalley chooseSubmitPath', () => {
  beforeEach(() => _resetRecipeCacheForTests());

  it('takes the legacy branch when BACKLINK_RECIPE_DISABLE=1', () => {
    const choice = chooseSubmitPath({ BACKLINK_RECIPE_DISABLE: '1' });
    assert.equal(choice.path, 'legacy');
    assert.equal(choice.recipe, null);
  });

  it('takes the recipe branch when env unset and recipe loads', () => {
    const choice = chooseSubmitPath({});
    assert.equal(choice.path, 'recipe');
    assert.ok(choice.recipe, 'recipe should be loaded from recipes/aivalley.yaml');
    assert.equal(choice.recipe.url, 'https://aivalley.ai/submit-tool/');
    // Sanity: the WPCF7 dual-textarea trick uses the |nth=N suffix.
    const longField = choice.recipe.fields.find((f) => f.key === 'longDescription');
    const shortField = choice.recipe.fields.find((f) => f.key === 'shortDescription');
    assert.ok(longField?.selector.endsWith('|nth=0'));
    assert.ok(shortField?.selector.endsWith('|nth=1'));
  });
});
