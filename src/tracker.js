// tracker.js — Submission status tracking (YAML file)

import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { createHash } from 'crypto';
import { parse, stringify } from 'yaml';
import lockfile from 'proper-lockfile';

const TRACKER_FILE = 'submissions.yaml';

// ---------------------------------------------------------------------------
// Product-hash helpers (used by the directory batch executor for dedup keys).
//
// productHash(product) — sha256(name|url|email) → first 12 hex chars.
// Stable per (name,url,email) tuple. Two different products from the same
// installation get distinct hashes, so the dedup map naturally namespaces by
// product even when submissions.yaml is shared across configs.
// ---------------------------------------------------------------------------

export function productHash(product = {}) {
  const name = String(product.name || '').trim();
  const url = String(product.url || '').trim();
  const email = String(product.email || '').trim();
  return createHash('sha256').update(`${name}|${url}|${email}`).digest('hex').slice(0, 12);
}

/**
 * Stamp a submission record with its product identity. submissions.yaml is
 * shared across configs — one install can submit several products over time —
 * so every record MUST name its product. Without it, downstream tooling that
 * aggregates by product (e.g. the reflow/backfill script) can only see an
 * opaque productHash and can't filter rows to a given product by name.
 *
 *   product      — human-readable name; what downstream tooling filters on
 *   productHash  — stable dedup key (see productHash above)
 *
 * Every write path (batch executor, interactive submit, manual mark-done)
 * spreads this onto its record so the field is never silently missing.
 */
export function productIdentity(product = {}) {
  const name = String(product.name || '').trim();
  return { product: name || null, productHash: productHash(product) };
}

/**
 * Build a Map<"<targetKey>::<productHash>", lastStatus> from submissions.yaml.
 *
 * Used by the directory batch executor as the dedup gate. Only the most
 * recent status per (targetKey, productHash) tuple is kept — later entries
 * overwrite earlier ones, so a `failed` followed by `submitted` reads as
 * `submitted` (and conversely, a `submitted` followed by `failed` reads as
 * `failed` — the executor only short-circuits on `submitted`).
 *
 * Accepts both new-style records (with `targetKey` + `productHash`) and old
 * `recordSubmission()` records (with `site` only). Old records are keyed
 * with `productHash = '*'` so a new productHash can never collide with them.
 */
export function loadSubmissionMap(submissionsPath = TRACKER_FILE) {
  const map = new Map();
  if (!existsSync(submissionsPath)) return map;
  let data;
  try {
    data = parse(readFileSync(submissionsPath, 'utf-8')) || { submissions: [] };
  } catch {
    return map;
  }
  for (const rec of data.submissions || []) {
    const targetKey = rec.targetKey || rec.site;
    if (!targetKey) continue;
    const hash = rec.productHash || '*';
    map.set(`${targetKey}::${hash}`, rec.status || null);
  }
  return map;
}

/**
 * Append a structured result record to submissions.yaml. Takes a file lock
 * so concurrent executor runs don't clobber each other. Used by the
 * directory batch executor; the legacy `recordSubmission()` API below is
 * kept untouched for blog-comment + interactive flows.
 */
export async function recordResult(submissionsPath, result) {
  const path = submissionsPath || TRACKER_FILE;
  if (!existsSync(path)) {
    writeFileSync(path, stringify({ submissions: [] }), 'utf-8');
  }
  let release;
  try {
    release = await lockfile.lock(path, {
      stale: 60000,
      retries: { retries: 3, minTimeout: 200 },
    });
    let data;
    try {
      data = parse(readFileSync(path, 'utf-8')) || { submissions: [] };
    } catch {
      data = { submissions: [] };
    }
    data.submissions = data.submissions || [];
    data.submissions.push(result);
    const tmp = path + '.tmp';
    writeFileSync(tmp, stringify(data), 'utf-8');
    renameSync(tmp, path);
  } finally {
    if (release) await release();
  }
}

export function loadTracker() {
  if (!existsSync(TRACKER_FILE)) {
    return { submissions: [] };
  }
  return parse(readFileSync(TRACKER_FILE, 'utf-8')) || { submissions: [] };
}

function saveTracker(data) {
  const tmp = TRACKER_FILE + '.tmp';
  writeFileSync(tmp, stringify(data), 'utf-8');
  renameSync(tmp, TRACKER_FILE);
}

export async function recordSubmission(site, status, details = {}) {
  // Ensure file exists before locking (lockfile requires the file to exist)
  if (!existsSync(TRACKER_FILE)) {
    writeFileSync(TRACKER_FILE, stringify({ submissions: [] }), 'utf-8');
  }

  let release;
  try {
    release = await lockfile.lock(TRACKER_FILE, {
      stale: 60000,
      retries: { retries: 3, minTimeout: 200 },
    });
    const tracker = loadTracker();
    tracker.submissions.push({
      site,
      status,
      timestamp: new Date().toISOString(),
      ...details,
    });
    saveTracker(tracker);
  } finally {
    if (release) await release();
  }
}

/**
 * Count how many of the most-recent submissions for `site` failed with this
 * exact `code`, walking backwards and stopping at the first record that
 * doesn't match. Used by the verdict layer to gate ambiguous codes
 * (NO_FIELDS / UNKNOWN_ERROR) behind a 2-strike rule so a single transient
 * blip doesn't lock a site out of auto submission.
 *
 * Note: returns the streak BEFORE the current failure is recorded. The
 * caller adds +1 for the in-flight failure if needed.
 */
export function getFailureStreak(site, code) {
  if (!site || !code) return 0;
  const tracker = loadTracker();
  const submissions = tracker.submissions || [];
  let streak = 0;
  for (let i = submissions.length - 1; i >= 0; i--) {
    const rec = submissions[i];
    if (rec.site !== site) continue;
    if (rec.status === 'failed' && rec.code === code) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

// Merge submissions.yaml + logs/global-history.json into one view.
// Returns { submissions, commentedUrls, hasSubmitted(site), hasCommented(url) }
export function loadAllHistory() {
  const submissions = loadTracker().submissions || [];

  let commentedUrls = new Set();
  try {
    const raw = readFileSync('logs/global-history.json', 'utf-8');
    commentedUrls = new Set(JSON.parse(raw));
  } catch {
    // File absent or malformed — treat as empty
  }

  return {
    submissions,
    commentedUrls,
    hasSubmitted: (site) => submissions.some((s) => s.site === site && s.status === 'submitted'),
    hasCommented: (url) => commentedUrls.has(url),
  };
}

export async function showStatus(opts = {}) {
  const history = loadAllHistory();
  const { submissions, commentedUrls } = history;

  if (opts.json) {
    console.log(JSON.stringify({ submissions, commentedUrls: [...commentedUrls] }, null, 2));
    return;
  }

  if (!submissions.length && !commentedUrls.size) {
    console.log('No submissions recorded yet.');
    return;
  }

  console.log('\n📊 Submission Status\n');

  const byStatus = {};
  for (const s of submissions) {
    const key = s.status || 'unknown';
    byStatus[key] = (byStatus[key] || 0) + 1;
  }

  for (const [status, count] of Object.entries(byStatus)) {
    const icon = status === 'submitted' ? '✅' : status === 'failed' ? '❌' : '⏳';
    console.log(`  ${icon} ${status}: ${count}`);
  }

  // Per-product breakdown — submissions.yaml is shared across configs, so when
  // more than one product is present, show submitted/total per product.
  const byProduct = {};
  for (const s of submissions) {
    const key = s.product || '(unlabeled)';
    if (!byProduct[key]) byProduct[key] = { total: 0, submitted: 0 };
    byProduct[key].total++;
    if (s.status === 'submitted') byProduct[key].submitted++;
  }
  const productKeys = Object.keys(byProduct);
  if (productKeys.length > 1) {
    console.log('\n  By product:');
    for (const [product, c] of Object.entries(byProduct).sort(([, a], [, b]) => b.submitted - a.submitted)) {
      console.log(`    🏷  ${product}: ${c.submitted}✅ / ${c.total}`);
    }
  }

  if (commentedUrls.size > 0) {
    console.log(`  💬 blog comments: ${commentedUrls.size}`);
  }

  console.log(`\n  Total: ${submissions.length} directory submissions, ${commentedUrls.size} blog comments\n`);

  if (submissions.length > 0) {
    console.log('Recent directory submissions:');
    for (const s of submissions.slice(-10)) {
      // Records come from two write paths with different field names:
      // interactive (site + timestamp) and batch (targetKey + submittedAt).
      const ts = s.timestamp || s.submittedAt;
      const date = ts ? new Date(ts).toLocaleDateString() : 'unknown date';
      const site = s.site || s.targetKey || 'unknown';
      const icon = s.status === 'submitted' ? '✅' : s.status === 'failed' ? '❌' : '⏳';
      console.log(`  ${icon} ${site} — ${s.status} (${date})`);
    }
  }
}
