// stats.js — Aggregate submission statistics from submissions.yaml.

import { loadTracker } from './tracker.js';

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function computeStats(submissions) {
  const total = submissions.length;
  const byStatus = {};
  for (const s of submissions) {
    const k = s.status || 'unknown';
    byStatus[k] = (byStatus[k] || 0) + 1;
  }

  const submitted = byStatus.submitted || 0;
  const failed = byStatus.failed || 0;
  const successRate = total > 0 ? ((submitted / total) * 100).toFixed(1) : '0.0';

  // Per-site success rate
  const bySite = {};
  for (const s of submissions) {
    if (!bySite[s.site]) bySite[s.site] = { submitted: 0, failed: 0 };
    if (s.status === 'submitted') bySite[s.site].submitted++;
    else if (s.status === 'failed') bySite[s.site].failed++;
  }

  // Timing (only for records that have duration_ms)
  const durations = submissions
    .filter((s) => typeof s.duration_ms === 'number')
    .map((s) => s.duration_ms)
    .sort((a, b) => a - b);

  const timing = durations.length
    ? {
        count: durations.length,
        p50: percentile(durations, 50),
        p95: percentile(durations, 95),
        min: durations[0],
        max: durations[durations.length - 1],
      }
    : null;

  return { total, byStatus, submitted, failed, successRate, bySite, timing };
}

export async function showStats(opts = {}) {
  const tracker = loadTracker();
  const submissions = tracker.submissions || [];

  if (!submissions.length) {
    console.log('No submissions recorded yet.');
    return;
  }

  const stats = computeStats(submissions);

  if (opts.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  console.log('\n📈 Submission Stats\n');
  console.log(`  Total:        ${stats.total}`);
  console.log(`  Submitted:    ${stats.submitted}`);
  console.log(`  Failed:       ${stats.failed}`);
  console.log(`  Success rate: ${stats.successRate}%`);

  if (opts.timing) {
    console.log('\n⏱  Timing (per-submission duration)\n');
    if (stats.timing) {
      const fmt = (ms) => `${(ms / 1000).toFixed(1)}s`;
      console.log(`  Samples: ${stats.timing.count}`);
      console.log(`  p50:     ${fmt(stats.timing.p50)}`);
      console.log(`  p95:     ${fmt(stats.timing.p95)}`);
      console.log(`  min:     ${fmt(stats.timing.min)}`);
      console.log(`  max:     ${fmt(stats.timing.max)}`);
    } else {
      console.log('  No timing data yet — run some submissions first.');
      console.log('  (duration_ms is recorded automatically from v2.2)');
    }
  }

  console.log('\n📊 Per-site summary (submitted → failed)\n');
  const sorted = Object.entries(stats.bySite).sort(
    ([, a], [, b]) => b.submitted - a.submitted || a.failed - b.failed
  );
  for (const [site, counts] of sorted.slice(0, 20)) {
    const bar = '✅'.repeat(counts.submitted) + '❌'.repeat(Math.min(counts.failed, 3));
    console.log(`  ${site.padEnd(30)} ${counts.submitted}✓  ${counts.failed}✗  ${bar}`);
  }
  if (sorted.length > 20) {
    console.log(`  ... and ${sorted.length - 20} more sites`);
  }
}
