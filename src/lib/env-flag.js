// env-flag.js — Tiny helper for interpreting env-var values as boolean flags.
//
// Treats common truthy strings (1, true, yes, on — case-insensitive, trimmed)
// as ON; everything else (including undefined, null, empty string, '0', 'false')
// as OFF. Avoids the brittle `=== '1'` check scattered across adapters.

export function isFlagOn(value) {
  if (value == null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}
