// doctor.js — Environment health check. Every failing item includes a fix command.

import { execSync } from 'child_process';
import { existsSync, accessSync, constants, readdirSync } from 'fs';
import { parse } from 'yaml';
import { readFileSync } from 'fs';

function check(label, ok, fix) {
  const icon = ok === null ? '⚠ ' : ok ? '✓ ' : '✗ ';
  const fixNote = !ok && fix ? `\n      → fix: ${fix}` : '';
  console.log(`  ${icon}${label}${fixNote}`);
  return !!ok;
}

function runCommand(cmd) {
  try {
    return execSync(cmd, { stdio: 'pipe' }).toString().trim();
  } catch {
    return null;
  }
}

function staleLockCount() {
  const now = Date.now();
  let count = 0;
  try {
    for (const f of readdirSync('.')) {
      if (!f.endsWith('.lock')) continue;
      try {
        const { mtimeMs } = { mtimeMs: existsSync(f) ? require('fs').statSync(f).mtimeMs : 0 };
        if (now - mtimeMs > 60_000) count++;
      } catch {}
    }
  } catch {}
  return count;
}

export async function runDoctor(opts = {}) {
  console.log('\n🩺 Backlink Pilot — Environment Check\n');

  let allOk = true;

  // Node version
  const nodeRaw = runCommand('node --version');
  const nodeMatch = nodeRaw?.match(/v(\d+)/);
  const nodeMajor = nodeMatch ? parseInt(nodeMatch[1]) : 0;
  const nodeOk = nodeMajor >= 18;
  allOk = check(`Node ${nodeRaw || 'not found'} (need 18+)`, nodeOk,
    'https://nodejs.org — install Node 18+') && allOk;

  // bb-browser installed
  const bbVersion = runCommand('bb-browser --version');
  const bbOk = !!bbVersion;
  allOk = check(`bb-browser ${bbVersion || 'not found'}`, bbOk,
    'npm install -g bb-browser') && allOk;

  // Chrome running (bb-browser can reach it)
  let chromeOk = false;
  if (bbOk) {
    const result = runCommand('bb-browser list-tabs 2>/dev/null');
    chromeOk = result !== null;
  }
  allOk = check('Chrome running', bbOk ? chromeOk : null,
    bbOk ? 'bb-browser open about:blank' : null) && allOk;

  // Stale lock files
  const staleLocks = staleLockCount();
  const locksOk = staleLocks === 0;
  allOk = check(
    staleLocks > 0 ? `${staleLocks} stale lock file(s) found` : 'No stale lock files',
    locksOk,
    locksOk ? null : 'node src/cli.js cleanup --locks'
  ) && allOk;

  // config.yaml
  const configExists = existsSync('config.yaml');
  let configValid = false;
  if (configExists) {
    try {
      const cfg = parse(readFileSync('config.yaml', 'utf-8'));
      configValid = !!(cfg?.product?.name && cfg?.product?.url);
    } catch {}
  }
  allOk = check(
    configExists ? (configValid ? 'config.yaml valid' : 'config.yaml exists but missing product.name or product.url') : 'config.yaml not found',
    configExists && configValid,
    configExists ? null : 'cp config.example.yaml config.yaml  # then edit it'
  ) && allOk;

  // submissions.yaml writable (or can be created)
  let submissionsWritable = false;
  try {
    if (existsSync('submissions.yaml')) {
      accessSync('submissions.yaml', constants.W_OK);
    }
    submissionsWritable = true;
  } catch {}
  allOk = check('submissions.yaml writable', submissionsWritable,
    'chmod 644 submissions.yaml') && allOk;

  console.log(allOk ? '\n✅ All checks passed\n' : '\n⚠  Some checks failed — fix the items above\n');
}
