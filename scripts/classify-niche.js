// classify-niche.js — Rule-map a group key to a niche; CLI writes niche back to targets.yaml.
//
// AI / awesome / community groups map deterministically (zero model cost).
// The "general" pools are tagged _unclassified for an agent (cheap model) to
// sub-classify into saas/devtools/startup/design/general — see scripts/README.md.

import { readFileSync, writeFileSync } from 'fs';
import { parseDocument } from 'yaml';

const ALLOWED = ['ai-tools', 'saas', 'devtools', 'startup', 'community', 'general', 'design'];

export function nicheForGroup(group) {
  if (/ai_director/i.test(group)) return 'ai-tools';
  if (group === 'awesome_lists') return 'devtools';
  if (group === 'reddit' || /communit/i.test(group)) return 'community';
  return '_unclassified';
}

function run({ apply }) {
  const path = 'targets.yaml';
  const doc = parseDocument(readFileSync(path, 'utf-8'));
  let added = 0, deferred = 0;

  for (const item of doc.contents.items) {       // top-level map: group -> seq
    const group = String(item.key);
    const seq = item.value;
    if (!seq || !seq.items) continue;
    for (const node of seq.items) {              // each node is a site map
      if (typeof node.get !== 'function') continue;
      if (node.get('niche') != null) continue;   // never overwrite an existing niche
      const niche = nicheForGroup(group);
      node.set('niche', niche);
      if (niche === '_unclassified') deferred++; else added++;
    }
  }

  console.log(`rule-mapped: ${added}, deferred to agent (_unclassified): ${deferred}`);
  if (apply) {
    writeFileSync(path, doc.toString());
    console.log(`✓ wrote ${path}`);
  } else {
    console.log('(dry-run — pass --apply to write)');
  }
}

/**
 * Apply an agent-produced { name: niche } map back to targets.yaml.
 * Only fills sites that are still `_unclassified` AND `auto: yes` — sites the
 * verdict layer has parked (auto:no/manual, dead/paid) won't be submitted, so
 * classifying them is pointless. Throws on any niche outside the whitelist.
 */
export function applyNicheMap(doc, map) {
  const allowed = new Set(ALLOWED);
  let applied = 0;
  for (const item of doc.contents.items) {
    if (!item.value?.items) continue;
    for (const node of item.value.items) {
      if (typeof node.get !== 'function') continue;
      const name = node.get('name');
      if (!Object.prototype.hasOwnProperty.call(map, name)) continue;
      if (node.get('niche') !== '_unclassified') continue;
      const auto = node.get('auto');
      if (auto !== 'yes' && auto !== true) continue;   // only sites that will actually be submitted
      const niche = map[name];
      if (!allowed.has(niche)) throw new Error(`Invalid niche "${niche}" for "${name}"`);
      node.set('niche', niche);
      applied++;
    }
  }
  return { applied };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mapIdx = process.argv.indexOf('--apply-map');
  if (mapIdx !== -1) {
    const arr = JSON.parse(readFileSync(process.argv[mapIdx + 1], 'utf-8'));
    const map = Array.isArray(arr)
      ? Object.fromEntries(arr.map(e => [e.name, e.niche]))
      : arr;
    const doc = parseDocument(readFileSync('targets.yaml', 'utf-8'));
    const { applied } = applyNicheMap(doc, map);
    writeFileSync('targets.yaml', doc.toString());
    console.log(`✓ applied niche to ${applied} auto:yes sites`);
  } else {
    run({ apply: process.argv.includes('--apply') });
  }
}

export { ALLOWED };
