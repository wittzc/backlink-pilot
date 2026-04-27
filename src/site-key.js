// site-key.js — Shared site-key slug helper.
//
// A siteKey is a stable, lowercase, alnum-with-dashes slug derived from a
// human-readable site name (or filename). It must match the convention used
// by `siteKeyFromName()` in src/triage.js — keep these two in sync.

export function siteKeyFromName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
