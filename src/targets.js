// targets.js — Mark individual sites in targets.yaml and record manual submissions.

import { existsSync } from 'fs';
import { flatten, loadTargetsDoc, saveTargetsDoc, backupTargets, TARGETS_FILE } from './yaml-utils.js';
import { recordSubmission, loadTracker } from './tracker.js';

function findEntry(all, siteName) {
  const lower = siteName.toLowerCase();
  return all.find(
    (f) =>
      f.entry.name?.toLowerCase() === lower ||
      (f.entry.submit_url || '').includes(siteName)
  );
}

export function markDead(siteName) {
  if (!existsSync(TARGETS_FILE)) throw new Error(`${TARGETS_FILE} not found`);
  const doc = loadTargetsDoc();
  const all = flatten(doc);
  const target = findEntry(all, siteName);
  if (!target) throw new Error(`"${siteName}" not found in targets.yaml`);
  backupTargets();
  target.entryNode.set('status', 'dead');
  saveTargetsDoc(doc);
  return target.entry;
}

export function markManual(siteName) {
  if (!existsSync(TARGETS_FILE)) throw new Error(`${TARGETS_FILE} not found`);
  const doc = loadTargetsDoc();
  const all = flatten(doc);
  const target = findEntry(all, siteName);
  if (!target) throw new Error(`"${siteName}" not found in targets.yaml`);
  backupTargets();
  target.entryNode.set('auto', 'manual');
  saveTargetsDoc(doc);
  return target.entry;
}

export async function markDone(siteName) {
  await recordSubmission(siteName, 'submitted', {
    note: 'Manually marked done',
  });
}
