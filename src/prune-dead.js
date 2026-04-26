// prune-dead.js — Probe targets.yaml URLs and mark unreachable ones as `status: dead`.
//
// Default is dry-run: prints candidates without writing.
// Use --apply to write `status: dead` (creates targets.yaml.bak first).
// Use --json for machine-readable output (Claude can parse).

import { existsSync } from 'fs';
import { flatten, loadTargetsDoc, saveTargetsDoc, backupTargets, TARGETS_FILE } from './yaml-utils.js';

const CONCURRENCY = 10;
const TIMEOUT_MS = 15000;
const RETRY_MAX = 3;

async function probeOnce(url, signal) {
  // HEAD first; some sites reject HEAD with 405/501 → fall back to GET.
  let res = await fetch(url, { method: 'HEAD', signal, redirect: 'follow' });
  if (res.status === 405 || res.status === 501) {
    res = await fetch(url, { method: 'GET', signal, redirect: 'follow' });
  }
  return res;
}

async function probeUrl(url) {
  for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await probeOnce(url, ctrl.signal);
      return { ok: res.status < 400, status: res.status, error: null };
    } catch (err) {
      if (attempt === RETRY_MAX) {
        return { ok: false, status: null, error: err.message || String(err) };
      }
      await new Promise((r) => setTimeout(r, 500 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
}

async function probeAll(entries, concurrency, onProgress) {
  const results = new Array(entries.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= entries.length) return;
      const r = await probeUrl(entries[i].submit_url);
      results[i] = r;
      onProgress?.(i + 1, entries.length, entries[i], r);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, entries.length) }, worker)
  );
  return results;
}

export async function pruneDead({ apply = false, json = false } = {}) {
  if (!existsSync(TARGETS_FILE)) {
    throw new Error(`${TARGETS_FILE} not found in cwd`);
  }
  const doc = loadTargetsDoc();

  const all = flatten(doc);
  const toProbe = all.filter((f) => f.entry.status !== 'dead');

  if (!json) {
    process.stderr.write(
      `Probing ${toProbe.length} sites (skipping ${all.length - toProbe.length} already dead)...\n`
    );
  }

  const probeResults = await probeAll(
    toProbe.map((f) => f.entry),
    CONCURRENCY,
    (n, total, entry, r) => {
      if (json) return;
      const icon = r.ok ? '✓' : '✗';
      const detail = r.error ? r.error : `http ${r.status}`;
      process.stderr.write(`  [${n}/${total}] ${icon} ${entry.name} (${detail})\n`);
    }
  );

  const candidates = toProbe
    .map((f, i) => ({ ...f, probe: probeResults[i] }))
    .filter((c) => !c.probe.ok);

  const today = new Date().toISOString().slice(0, 10);

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          apply,
          probed: toProbe.length,
          skipped_already_dead: all.length - toProbe.length,
          dead_candidates: candidates.length,
          candidates: candidates.map((c) => ({
            name: c.entry.name,
            submit_url: c.entry.submit_url,
            category: c.categoryKey,
            current_status: c.entry.status || null,
            probe_status: c.probe.status,
            error: c.probe.error,
            reason: c.probe.error ? `network: ${c.probe.error}` : `http ${c.probe.status}`,
          })),
        },
        null,
        2
      ) + '\n'
    );
  } else {
    process.stdout.write(`\nFound ${candidates.length} dead candidates:\n\n`);
    for (const c of candidates) {
      const reason = c.probe.error ? `network: ${c.probe.error}` : `http ${c.probe.status}`;
      process.stdout.write(`  ✗ ${c.entry.name} — ${reason}\n`);
      process.stdout.write(`    ${c.entry.submit_url}\n`);
    }
  }

  if (!apply) {
    if (!json) {
      process.stdout.write(
        `\n(dry-run) Use --apply to mark these as status: dead in targets.yaml\n`
      );
    }
    return { candidates, applied: false };
  }

  if (candidates.length === 0) {
    if (!json) process.stdout.write('\nNothing to apply.\n');
    return { candidates, applied: false };
  }

  // Apply: backup → mutate doc nodes (preserves comments) → atomic write
  const bakPath = backupTargets();

  for (const c of candidates) {
    c.entryNode.set('status', 'dead');
    if (!c.entryNode.get('notes')) {
      c.entryNode.set('notes', `Auto-marked dead on ${today}`);
    }
  }

  saveTargetsDoc(doc);

  if (!json) {
    process.stdout.write(`\n✓ Marked ${candidates.length} sites as dead\n`);
    process.stdout.write(`  Backup: ${bakPath}\n`);
    process.stdout.write(`  Written: ${TARGETS_FILE}\n`);
    process.stdout.write(`  Restore with: mv ${bakPath} ${TARGETS_FILE}\n`);
  }

  return { candidates, applied: true };
}
