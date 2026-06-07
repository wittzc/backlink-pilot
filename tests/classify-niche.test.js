import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nicheForGroup } from '../scripts/classify-niche.js';

test('AI directory groups map to ai-tools', () => {
  assert.equal(nicheForGroup('overseas_ai_directories'), 'ai-tools');
  assert.equal(nicheForGroup('chinese_ai_directories'), 'ai-tools');
});

test('awesome lists map to devtools', () => {
  assert.equal(nicheForGroup('awesome_lists'), 'devtools');
});

test('reddit and communities map to community', () => {
  assert.equal(nicheForGroup('reddit'), 'community');
  assert.equal(nicheForGroup('communities_manual'), 'community');
});

test('general pools defer to agent (_unclassified)', () => {
  assert.equal(nicheForGroup('overseas_general'), '_unclassified');
  assert.equal(nicheForGroup('overseas_directories'), '_unclassified');
  assert.equal(nicheForGroup('chinese_general'), '_unclassified');
});
