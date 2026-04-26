import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiValleyDescriptions,
  aiValleySubmitterName,
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
