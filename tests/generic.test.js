import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSnapshot } from '../src/sites/generic.js';

describe('generic snapshot parsing', () => {
  it('associates labels with following controls', () => {
    const fields = parseSnapshot(`
label [ref=8] "Your Name"
textbox [ref=9] "Jane Doe"
label [ref=10] "Tool Name *"
textbox [ref=11] "e.g. ChatGPT"
label [ref=12] "Tool URL *"
textbox [ref=13] "https://example.com"
label [ref=14] "Short Description *"
textbox [ref=15] "Briefly describe what the tool does..."
label [ref=27] "Your Email *"
textbox [ref=28] "you@example.com"
button [ref=31] "Submit Tool"
`);

    assert.equal(fields.name, '@11');
    assert.equal(fields.url, '@13');
    assert.equal(fields.description, '@15');
    assert.equal(fields.email, '@28');
    assert.equal(fields.submit, '@31');
  });

  it('keeps standalone name as fallback when no product label exists', () => {
    const fields = parseSnapshot(`
textbox [ref=2] "Name"
textbox [ref=4] "Website URL"
textbox [ref=6] "Description"
`);

    assert.equal(fields.name, '@2');
    assert.equal(fields.url, '@4');
    assert.equal(fields.description, '@6');
  });
});
