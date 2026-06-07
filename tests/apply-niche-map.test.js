import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument } from 'yaml';
import { applyNicheMap } from '../scripts/classify-niche.js';

function nicheOf(doc, name) {
  for (const item of doc.contents.items)
    for (const node of item.value.items)
      if (node.get('name') === name) return node.get('niche');
  return undefined;
}

test('applyNicheMap fills niche only for auto:yes _unclassified sites', () => {
  const doc = parseDocument(`group:
  - name: SaaSHub
    auto: yes
    niche: _unclassified
  - name: DeadSite
    auto: no
    niche: _unclassified
  - name: FutureTools
    auto: yes
    niche: ai-tools
`);
  const res = applyNicheMap(doc, { SaaSHub: 'saas', DeadSite: 'general', FutureTools: 'general' });

  assert.equal(nicheOf(doc, 'SaaSHub'), 'saas');           // auto:yes + _unclassified → mapped
  assert.equal(nicheOf(doc, 'DeadSite'), '_unclassified'); // auto:no → skipped (won't be submitted)
  assert.equal(nicheOf(doc, 'FutureTools'), 'ai-tools');   // already set → never overwritten
  assert.equal(res.applied, 1);
});

test('applyNicheMap rejects niche values outside the whitelist', () => {
  const doc = parseDocument(`group:
  - name: X
    auto: yes
    niche: _unclassified
`);
  assert.throws(() => applyNicheMap(doc, { X: 'bogus' }), /bogus/);
});
