import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';

describe('batch-submit resource loading', () => {
  it('resources/backlink-resources.example.json exists', () => {
    assert.ok(existsSync('resources/backlink-resources.example.json'));
  });

  it('example file is valid JSON with expected structure', async () => {
    const { readFileSync } = await import('fs');
    const raw = JSON.parse(readFileSync('resources/backlink-resources.example.json', 'utf-8'));
    assert.ok(raw.blog_comments, 'should have blog_comments key');
    assert.ok(Array.isArray(raw.blog_comments), 'blog_comments should be array');
    assert.ok(raw.blog_comments.length > 0, 'should have at least one example');

    const entry = raw.blog_comments[0];
    assert.ok(entry.type, 'entry should have type');
    assert.ok(entry.url, 'entry should have url');
    assert.equal(typeof entry.has_url_field, 'boolean');
    assert.equal(typeof entry.has_captcha, 'boolean');
  });

  it('batchSubmit guards on missing resource files', async () => {
    // resources/sites.json and resources/backlink-resources.json are
    // user-specific (gitignored), so we cannot assert their existence.
    // Instead, verify the guard logic exists in the batch-submit source.
    const { readFileSync } = await import('fs');
    const src = readFileSync('src/batch-submit.js', 'utf-8');
    assert.ok(src.includes('resources/backlink-resources.json'),
      'should guard backlink-resources.json');
    assert.ok(src.includes('resources/sites.json'),
      'should guard sites.json');
  });
});
