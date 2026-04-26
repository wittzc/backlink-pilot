import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  futureToolsCategory,
  futureToolsPricing,
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
