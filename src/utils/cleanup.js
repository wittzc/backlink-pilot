// cleanup.js — Clean old screenshots and zombie lock files.

import { readdirSync, statSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

const SCREENSHOT_DIR = './screenshots';
const SCREENSHOT_PATTERN = /^.+-\d{4}-\d{2}-\d{2}\.png$/;
const LOCK_PATTERN = /\.lock$/;
const STALE_LOCK_MS = 60_000;

export function cleanupScreenshots(keepDays = 30) {
  if (!existsSync(SCREENSHOT_DIR)) {
    console.log('No screenshots directory found — nothing to clean.');
    return 0;
  }
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  let deleted = 0;
  for (const f of readdirSync(SCREENSHOT_DIR)) {
    if (!SCREENSHOT_PATTERN.test(f)) continue;
    const fp = join(SCREENSHOT_DIR, f);
    if (statSync(fp).mtimeMs < cutoff) {
      unlinkSync(fp);
      deleted++;
    }
  }
  console.log(
    deleted > 0
      ? `Deleted ${deleted} screenshot(s) older than ${keepDays} days.`
      : `No screenshots older than ${keepDays} days.`
  );
  return deleted;
}

export function cleanupLocks() {
  const now = Date.now();
  let cleaned = 0;
  for (const f of readdirSync('.')) {
    if (!LOCK_PATTERN.test(f)) continue;
    try {
      const age = now - statSync(f).mtimeMs;
      if (age > STALE_LOCK_MS) {
        unlinkSync(f);
        console.log(`  Removed stale lock: ${f} (${Math.round(age / 1000)}s old)`);
        cleaned++;
      }
    } catch {
      // Ignore – might have been cleaned by another process
    }
  }
  if (cleaned === 0) console.log('No stale lock files found.');
  return cleaned;
}
