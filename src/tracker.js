// tracker.js — Submission status tracking (YAML file)

import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { parse, stringify } from 'yaml';
import lockfile from 'proper-lockfile';

const TRACKER_FILE = 'submissions.yaml';

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

  if (commentedUrls.size > 0) {
    console.log(`  💬 blog comments: ${commentedUrls.size}`);
  }

  console.log(`\n  Total: ${submissions.length} directory submissions, ${commentedUrls.size} blog comments\n`);

  if (submissions.length > 0) {
    console.log('Recent directory submissions:');
    for (const s of submissions.slice(-10)) {
      const date = new Date(s.timestamp).toLocaleDateString();
      const icon = s.status === 'submitted' ? '✅' : s.status === 'failed' ? '❌' : '⏳';
      console.log(`  ${icon} ${s.site} — ${s.status} (${date})`);
    }
  }
}
