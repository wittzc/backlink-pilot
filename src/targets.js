// targets.js — Mark individual sites in targets.yaml and record manual submissions.

import { existsSync } from 'fs';
import { flatten, loadTargetsDoc, saveTargetsDoc, backupTargets, TARGETS_FILE } from './yaml-utils.js';
import { recordSubmission, getFailureStreak } from './tracker.js';

// Verdict table — what happens to targets.yaml after a failure with a given
// error code. `op` is what we write; `streak` (if set) is the number of
// consecutive same-code failures (current included) required before the op
// fires, used to filter out transient blips for ambiguous codes.
const VERDICT_TABLE = {
  PAGE_404:        { op: { status: 'dead', auto: 'no' } },
  PAID_WALL:       { op: { status: 'paid', auto: 'no' } },
  LOGIN_REQUIRED:  { op: { auto: 'manual' } },
  IFRAME_FORM:     { op: { auto: 'no' }, reason: 'iframe form — generic adapter cannot fill cross-frame' },
  NO_FIELDS:       { op: { auto: 'no' }, reason: 'no recognizable form fields after long-wait scan', streak: 2 },
  UNKNOWN_ERROR:   { op: { auto: 'no' }, reason: 'repeated unclassified failure', streak: 2 },
  // SERVER_ERROR / CHROME_TIMEOUT / CAPTCHA_FAILED — intentionally unlisted.
  // These are transient or ambiguous; let the operator decide.
};

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

/**
 * Idempotent failure verdict — consult VERDICT_TABLE for the given error
 * code, gate ambiguous codes behind a streak threshold, and write the
 * verdict to targets.yaml if the entry needs updating.
 *
 * Returns { applied: boolean, op: object|null, reason: string|null,
 *           skipped: 'no-rule'|'streak'|'no-entry'|'already-applied'|null }.
 *
 * Designed to be called from submit.js right AFTER recordSubmission, so the
 * in-flight failure is already in the streak count.
 */
export function applyFailureVerdict(siteName, code) {
  const rule = VERDICT_TABLE[code];
  if (!rule) return { applied: false, op: null, reason: null, skipped: 'no-rule' };

  if (rule.streak) {
    const streak = getFailureStreak(siteName, code);
    if (streak < rule.streak) {
      return { applied: false, op: null, reason: null, skipped: 'streak', streak, threshold: rule.streak };
    }
  }

  if (!existsSync(TARGETS_FILE)) return { applied: false, op: null, reason: null, skipped: 'no-entry' };
  const doc = loadTargetsDoc();
  const all = flatten(doc);
  const target = findEntry(all, siteName);
  if (!target) return { applied: false, op: null, reason: null, skipped: 'no-entry' };

  // Skip if entry is already in a "more terminal" state than what we'd write.
  // Concretely: never overwrite status=dead with anything weaker, and don't
  // re-stamp the same op repeatedly.
  const current = target.entry;
  if (current.status === 'dead') {
    return { applied: false, op: null, reason: null, skipped: 'already-applied' };
  }
  const wouldChange = Object.entries(rule.op).some(([k, v]) => current[k] !== v);
  if (!wouldChange) {
    return { applied: false, op: null, reason: null, skipped: 'already-applied' };
  }

  backupTargets();
  for (const [k, v] of Object.entries(rule.op)) {
    target.entryNode.set(k, v);
  }
  if (rule.reason) {
    const today = new Date().toISOString().slice(0, 10);
    target.entryNode.set('auto_blocked_reason', `${code}: ${rule.reason} (${today})`);
  } else {
    // Even without a free-text reason, leave the code so future runs can
    // grep why a site was demoted.
    const today = new Date().toISOString().slice(0, 10);
    target.entryNode.set('auto_blocked_reason', `${code} (${today})`);
  }
  saveTargetsDoc(doc);
  return { applied: true, op: rule.op, reason: rule.reason || null, name: target.entry.name, skipped: null };
}
