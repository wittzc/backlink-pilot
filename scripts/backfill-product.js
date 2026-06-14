#!/usr/bin/env node
// backfill-product.js — stamp `product` onto historical submissions.yaml
// records that predate product-identity stamping (see src/tracker.js).
//
// submissions.yaml is shared across configs but older records carry no
// product name. This backfills it where it can be done RELIABLY:
//
//   1. productHash match — a record's productHash is sha256(name|url|email).
//      If it equals the hash of a current config*.yaml product, that record
//      provably belongs to that product → stamp the config's product name.
//   2. known alias — a record hand-labeled with a historical name variant
//      (ALIASES below) is normalised to the canonical product name.
//   3. neither — records with no productHash and no recognisable name are
//      LEFT as unlabeled. There is no reliable signal to attribute them, and
//      guessing would corrupt per-product stats.
//
// Idempotent: re-running changes nothing further. Always back up first
// (cp submissions.yaml submissions.yaml.bak-<date>).
//
// ⚠️ NO FILE LOCK. This does a full read-modify-write of submissions.yaml.
// If a submit/batch run appends a record between this script's read and write,
// that record is silently overwritten. Run ONLY when no submission is in
// flight (check: ps aux | grep "cli.js submit\|batch-submit").
//
// Usage:
//   node scripts/backfill-product.js            # apply
//   node scripts/backfill-product.js --dry-run  # preview only

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { parse, stringify } from 'yaml';
import { productHash } from '../src/tracker.js';

// Historical hand-labels that mean the same product under a different string.
// Extend per install as needed.
const ALIASES = {
  'addfamilyphoto.com': 'AddFamilyPhoto',
};

const SUBMISSIONS = 'submissions.yaml';
const dryRun = process.argv.includes('--dry-run');

if (!existsSync(SUBMISSIONS)) {
  console.error(`No ${SUBMISSIONS} in cwd — run from the project root.`);
  process.exit(1);
}

// Build productHash → name from every config (config.yaml + config.<x>.yaml),
// skipping the example template.
const hashToName = {};
for (const f of readdirSync('.')) {
  if (!/^config(\..+)?\.ya?ml$/.test(f) || f.includes('example')) continue;
  try {
    const cfg = parse(readFileSync(f, 'utf-8'));
    if (cfg?.product?.name) hashToName[productHash(cfg.product)] = cfg.product.name;
  } catch {
    /* unparseable config — skip */
  }
}

const data = parse(readFileSync(SUBMISSIONS, 'utf-8')) || { submissions: [] };
const records = data.submissions || [];

const tally = (recs) => {
  const out = {};
  for (const s of recs) out[s.product || '(unlabeled)'] = (out[s.product || '(unlabeled)'] || 0) + 1;
  return out;
};

const before = tally(records);
let byHash = 0;
let byAlias = 0;
for (const s of records) {
  let target = null;
  if (s.productHash && hashToName[s.productHash]) target = hashToName[s.productHash];
  else if (s.product && ALIASES[s.product]) target = ALIASES[s.product];
  if (target && s.product !== target) {
    s.product = target;
    if (s.productHash && hashToName[s.productHash]) byHash++;
    else byAlias++;
  }
}
const after = tally(records);

console.log('config productHash map:');
for (const [h, n] of Object.entries(hashToName)) console.log(`  ${h} → ${n}`);
console.log(`\n${records.length} records  (changed: ${byHash} by hash, ${byAlias} by alias)\n`);
console.log('product breakdown  before → after:');
const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
for (const k of keys) console.log(`  ${k.padEnd(24)} ${(before[k] || 0)} → ${(after[k] || 0)}`);

if (dryRun) {
  console.log('\n[dry-run] no file written.');
} else {
  writeFileSync(SUBMISSIONS, stringify(data), 'utf-8');
  console.log(`\n✓ wrote ${SUBMISSIONS}`);
}
