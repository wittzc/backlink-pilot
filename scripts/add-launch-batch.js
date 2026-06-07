// add-launch-batch.js — Append a batch of evaluated sites to targets.yaml as a
// new group. Input JSON: [{name, submit_url, type, auto, status?, lang, niche, notes}].
// Idempotent on name: sites already present (by name) are skipped.
//
// Usage: node scripts/add-launch-batch.js <sites.json> <group_key> [--apply]

import { readFileSync, writeFileSync } from 'fs';
import { parseDocument } from 'yaml';

const ALLOWED_NICHE = new Set(['ai-tools', 'saas', 'devtools', 'startup', 'community', 'general', 'design']);

function existingNames(doc) {
  const names = new Set();
  for (const item of doc.contents.items) {
    if (!item.value?.items) continue;
    for (const node of item.value.items) {
      if (typeof node.get === 'function' && node.get('name') != null) names.add(node.get('name'));
    }
  }
  return names;
}

function q(v) { return JSON.stringify(String(v)); } // safe yaml scalar (JSON is valid YAML)

function entryYaml(s) {
  const lines = [
    `  - name: ${q(s.name)}`,
    `    submit_url: ${q(s.submit_url)}`,
    `    type: ${s.type}`,
    `    auto: ${s.auto}`,
  ];
  if (s.status) lines.push(`    status: ${s.status}`);
  lines.push(`    lang: ${s.lang}`);
  lines.push(`    niche: ${s.niche}`);
  if (s.notes) lines.push(`    notes: ${q(s.notes)}`);
  return lines.join('\n');
}

function run({ sitesPath, groupKey, apply }) {
  const sites = JSON.parse(readFileSync(sitesPath, 'utf-8'));
  for (const s of sites) {
    if (!ALLOWED_NICHE.has(s.niche)) throw new Error(`Invalid niche "${s.niche}" for "${s.name}"`);
  }

  const raw = readFileSync('targets.yaml', 'utf-8');
  const have = existingNames(parseDocument(raw));
  const fresh = sites.filter(s => !have.has(s.name));
  const skipped = sites.length - fresh.length;

  const block = `\n# ============================================================\n`
    + `# Launch batch (evaluated ${groupKey})\n`
    + `# ============================================================\n`
    + `${groupKey}:\n`
    + fresh.map(entryYaml).join('\n') + '\n';

  const next = raw.replace(/\n*$/, '\n') + block;
  // Validate it still parses before writing
  parseDocument(next);

  console.log(`new: ${fresh.length}, skipped (name exists): ${skipped}`);
  if (apply) {
    writeFileSync('targets.yaml', next);
    console.log('✓ wrote targets.yaml');
  } else {
    console.log('(dry-run — pass --apply to write)');
  }
}

run({
  sitesPath: process.argv[2],
  groupKey: process.argv[3] || 'overseas_launch_2026_06',
  apply: process.argv.includes('--apply'),
});
