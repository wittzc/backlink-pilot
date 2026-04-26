import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pruneDead } from '../src/prune-dead.js';

const FIXTURE_YAML = `# Targets header (must be preserved)
overseas_ai_directories:
  - name: Alive Site
    submit_url: https://alive.test/submit
    type: form
    auto: yes

  - name: Dead Site
    submit_url: https://dead.test/submit
    type: form
    auto: yes

  - name: Already Dead
    submit_url: https://already.test/
    type: form
    auto: no
    status: dead
    notes: "Marked dead earlier"

  - name: Server Error
    submit_url: https://err500.test/
    type: form
    auto: yes
`;

let tmpDir;
let originalCwd;
let originalFetch;

function setupFixture() {
  tmpDir = mkdtempSync(join(tmpdir(), 'prune-dead-test-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  writeFileSync('targets.yaml', FIXTURE_YAML, 'utf-8');
}

function teardownFixture() {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  globalThis.fetch = originalFetch;
}

function mockFetch(map) {
  // map: { url -> { status } | () => Promise<...> | Error }
  return async (url, opts) => {
    const entry = map[url];
    if (!entry) throw new Error(`Unmocked URL: ${url}`);
    if (entry instanceof Error) throw entry;
    if (typeof entry === 'function') return entry(url, opts);
    return new Response(null, { status: entry.status });
  };
}

describe('pruneDead', () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    setupFixture();
  });

  afterEach(() => {
    teardownFixture();
  });

  it('dry-run identifies dead candidates without writing', async () => {
    globalThis.fetch = mockFetch({
      'https://alive.test/submit': { status: 200 },
      'https://dead.test/submit': { status: 404 },
      'https://err500.test/': { status: 500 },
    });

    const result = await pruneDead({ apply: false, json: true });

    assert.equal(result.applied, false);
    assert.equal(result.candidates.length, 2);
    const names = result.candidates.map((c) => c.entry.name).sort();
    assert.deepEqual(names, ['Dead Site', 'Server Error']);

    // No file writes in dry-run
    assert.equal(existsSync('targets.yaml.bak'), false);
    // targets.yaml unchanged
    assert.equal(readFileSync('targets.yaml', 'utf-8'), FIXTURE_YAML);
  });

  it('skips already-dead entries (does not re-probe)', async () => {
    let probedAlready = false;
    globalThis.fetch = mockFetch({
      'https://alive.test/submit': { status: 200 },
      'https://dead.test/submit': { status: 404 },
      'https://err500.test/': { status: 500 },
      'https://already.test/': () => {
        probedAlready = true;
        return new Response(null, { status: 200 });
      },
    });

    await pruneDead({ apply: false, json: true });
    assert.equal(probedAlready, false, 'already-dead URL must not be probed');
  });

  it('--apply writes status: dead, creates .bak, and preserves comments', async () => {
    globalThis.fetch = mockFetch({
      'https://alive.test/submit': { status: 200 },
      'https://dead.test/submit': { status: 404 },
      'https://err500.test/': { status: 500 },
    });

    const result = await pruneDead({ apply: true, json: true });

    assert.equal(result.applied, true);
    assert.equal(existsSync('targets.yaml.bak'), true);
    assert.equal(readFileSync('targets.yaml.bak', 'utf-8'), FIXTURE_YAML);

    const updated = readFileSync('targets.yaml', 'utf-8');
    // Header comment preserved
    assert.match(updated, /# Targets header/);
    // The two newly-dead entries gained status: dead
    assert.match(updated, /name:\s*Dead Site[\s\S]*?status:\s*dead/);
    assert.match(updated, /name:\s*Server Error[\s\S]*?status:\s*dead/);
    // The alive entry was NOT touched
    const aliveBlock = updated.match(/name:\s*Alive Site[\s\S]*?(?=\n\s*-|\Z)/);
    assert.ok(aliveBlock);
    assert.doesNotMatch(aliveBlock[0], /status:/);
  });

  it('retries 3 times on transient network failure before giving up', async () => {
    let attempts = 0;
    globalThis.fetch = mockFetch({
      'https://alive.test/submit': { status: 200 },
      'https://dead.test/submit': () => {
        attempts++;
        throw new Error('ECONNREFUSED');
      },
      'https://err500.test/': { status: 500 },
    });

    const result = await pruneDead({ apply: false, json: true });

    assert.equal(attempts, 3, 'should retry 3 times');
    const deadByName = result.candidates.find((c) => c.entry.name === 'Dead Site');
    assert.ok(deadByName);
    assert.match(deadByName.probe.error, /ECONNREFUSED/);
  });

  it('falls back to GET when HEAD returns 405', async () => {
    let getCalled = false;
    globalThis.fetch = async (url, opts) => {
      if (url === 'https://alive.test/submit') {
        if (opts?.method === 'HEAD') return new Response(null, { status: 405 });
        if (opts?.method === 'GET') {
          getCalled = true;
          return new Response(null, { status: 200 });
        }
      }
      if (url === 'https://dead.test/submit') return new Response(null, { status: 404 });
      if (url === 'https://err500.test/') return new Response(null, { status: 500 });
      throw new Error(`Unmocked: ${url}`);
    };

    const result = await pruneDead({ apply: false, json: true });
    assert.equal(getCalled, true, 'must fall back to GET on 405');
    // Alive site (now 200 via GET) should NOT be a candidate
    const aliveAsCandidate = result.candidates.find((c) => c.entry.name === 'Alive Site');
    assert.equal(aliveAsCandidate, undefined);
  });
});
