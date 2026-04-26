#!/usr/bin/env node
// update-readme-stats.js — Replace stats placeholders in README files with
// numbers computed from targets.yaml.
//
// Placeholder format: <!-- stats:KEY -->NUMBER<!-- /stats -->
// Supported keys: total | auto-yes | auto-manual | auto-no | dead | paid

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';

const TARGETS_FILE = 'targets.yaml';
// All files that may contain <!-- stats:KEY --> placeholders.
const README_FILES = [
  'README.md',
  'README.zh.md',
  'docs/index.md',
  'docs/guide.md',
];

export function computeStatsFromYaml(yamlText) {
  const data = parse(yamlText);
  const stats = {
    total: 0,
    'auto-yes': 0,
    'auto-manual': 0,
    'auto-no': 0,
    dead: 0,
    paid: 0,
  };
  for (const entries of Object.values(data || {})) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      if (!entry.submit_url) continue;
      stats.total++;
      // YAML 1.2 (yaml lib default) does NOT treat `yes/no` as booleans —
      // they parse as strings. Match both forms to be safe across YAML versions.
      const auto = entry.auto;
      if (auto === true || auto === 'yes') stats['auto-yes']++;
      else if (auto === false || auto === 'no') stats['auto-no']++;
      else if (auto === 'manual') stats['auto-manual']++;
      if (entry.status === 'dead') stats.dead++;
      if (entry.status === 'paid') stats.paid++;
    }
  }
  return stats;
}

export function replacePlaceholders(text, stats) {
  let replaced = 0;
  const out = text.replace(
    /<!--\s*stats:([\w-]+)\s*-->[^<]*<!--\s*\/stats\s*-->/g,
    (match, key) => {
      if (!(key in stats)) {
        process.stderr.write(`  ⚠ Unknown stats key: ${key}\n`);
        return match;
      }
      replaced++;
      return `<!-- stats:${key} -->${stats[key]}<!-- /stats -->`;
    }
  );
  return { out, replaced };
}

function main() {
  if (!existsSync(TARGETS_FILE)) {
    process.stderr.write(`Error: ${TARGETS_FILE} not found in cwd\n`);
    process.exit(1);
  }
  const stats = computeStatsFromYaml(readFileSync(TARGETS_FILE, 'utf-8'));
  process.stderr.write(`Computed stats: ${JSON.stringify(stats)}\n`);

  let totalReplaced = 0;
  for (const file of README_FILES) {
    if (!existsSync(file)) {
      process.stderr.write(`  ⚠ ${file} not found, skipping\n`);
      continue;
    }
    const original = readFileSync(file, 'utf-8');
    const { out, replaced } = replacePlaceholders(original, stats);
    if (out !== original) {
      writeFileSync(file, out, 'utf-8');
      process.stderr.write(`  ✓ ${file}: ${replaced} placeholder(s) updated\n`);
    } else {
      process.stderr.write(`  · ${file}: no placeholders found (or no change)\n`);
    }
    totalReplaced += replaced;
  }
  process.stderr.write(`\nDone. ${totalReplaced} total replacements.\n`);
}

// Run main() only when invoked as a script, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
