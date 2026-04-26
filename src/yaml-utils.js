// yaml-utils.js — Shared helpers for targets.yaml parsing and mutation.
// Using parseDocument preserves header comments and field ordering on save.

import { readFileSync, writeFileSync, renameSync, copyFileSync } from 'fs';
import { parseDocument } from 'yaml';

export const TARGETS_FILE = 'targets.yaml';

export function loadTargetsDoc() {
  const raw = readFileSync(TARGETS_FILE, 'utf-8');
  return parseDocument(raw);
}

// Walk the grouped YAML structure and return a flat list of
// { categoryKey, entryNode, entry } for every entry that has a submit_url.
// entryNode is a live YAMLMap reference — mutations to it persist when you
// call saveTargetsDoc().
export function flatten(doc) {
  const out = [];
  if (!doc.contents?.items) return out;
  for (const pair of doc.contents.items) {
    const categoryKey = pair.key?.value;
    const list = pair.value;
    if (!list?.items) continue;
    for (const entryNode of list.items) {
      if (!entryNode || typeof entryNode.get !== 'function') continue;
      const submit_url = entryNode.get('submit_url');
      if (!submit_url) continue;
      const entry = entryNode.toJSON();
      out.push({ categoryKey, entryNode, entry });
    }
  }
  return out;
}

export function saveTargetsDoc(doc) {
  const tmp = TARGETS_FILE + '.tmp';
  writeFileSync(tmp, doc.toString(), 'utf-8');
  renameSync(tmp, TARGETS_FILE);
}

export function backupTargets() {
  const bak = TARGETS_FILE + '.bak';
  copyFileSync(TARGETS_FILE, bak);
  return bak;
}
