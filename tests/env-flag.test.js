import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isFlagOn } from '../src/lib/env-flag.js';

describe('isFlagOn', () => {
  it('treats common truthy strings as ON (case-insensitive, whitespace-tolerant)', () => {
    assert.equal(isFlagOn('1'), true);
    assert.equal(isFlagOn('true'), true);
    assert.equal(isFlagOn('TRUE'), true);
    assert.equal(isFlagOn('yes'), true);
    assert.equal(isFlagOn(' on '), true);
  });

  it('treats unset / falsy strings as OFF', () => {
    assert.equal(isFlagOn('0'), false);
    assert.equal(isFlagOn('false'), false);
    assert.equal(isFlagOn(''), false);
    assert.equal(isFlagOn(undefined), false);
    assert.equal(isFlagOn(null), false);
  });

  it('treats unrelated values as OFF', () => {
    assert.equal(isFlagOn('maybe'), false);
    assert.equal(isFlagOn('2'), false);
    assert.equal(isFlagOn('off'), false);
  });
});
