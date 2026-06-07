import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRecipeValue } from '../src/sites/form-recipe.js';

test('submit_text overrides description when present', () => {
  const product = { description: 'short', long_description: 'long', submit_text: 'tailored' };
  assert.equal(resolveRecipeValue(product, 'description'), 'tailored');
  assert.equal(resolveRecipeValue(product, 'longDescription'), 'tailored');
});

test('without submit_text, original description behavior is preserved', () => {
  const product = { description: 'short', long_description: 'long' };
  assert.equal(resolveRecipeValue(product, 'description'), 'short');
  assert.equal(resolveRecipeValue(product, 'longDescription'), 'long');
});
