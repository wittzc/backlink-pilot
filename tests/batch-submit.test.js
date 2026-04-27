// tests/batch-submit.test.js — Directory batch executor (Task 5).
//
// All adapter calls go through an injected mock dispatcher; no real network
// or browser is touched. Sleep is also injected so the tests don't actually
// wait 60-180s between targets.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  parseForceFlag,
  adapterTypeForBucket,
  prepareTargets,
  filterAndSort,
  loadTriageReport,
  runBatch,
} from '../src/batch-submit.js';
import {
  productHash,
  loadSubmissionMap,
  recordResult,
} from '../src/tracker.js';

// --- Fixtures --------------------------------------------------------------

const PRODUCT = {
  name: 'Metric Converter',
  url: 'https://metric-converter.net',
  email: 'hello@metric-converter.net',
};

function tmpFile(name = 'submissions.yaml') {
  const dir = mkdtempSync(join(tmpdir(), 'bp-batch-'));
  return { dir, path: join(dir, name) };
}

function quietLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function mkTarget(overrides = {}) {
  return {
    name: overrides.name || 'Site X',
    siteKey: overrides.siteKey || 'site-x',
    submit_url: overrides.submit_url || 'https://example.com/submit',
    category: overrides.category || 'overseas_ai_directories',
    bucket: overrides.bucket || 'generic-ready',
    adapterType: overrides.adapterType || adapterTypeForBucket(overrides.bucket || 'generic-ready'),
    code: overrides.code || 'GENERIC_READY',
    reason: overrides.reason || null,
    provider: overrides.provider || null,
    provider_url: overrides.provider_url || null,
    value_tier: overrides.value_tier || 3,
  };
}

// --- parseForceFlag --------------------------------------------------------

describe('parseForceFlag', () => {
  it('returns empty map for empty / undefined input', () => {
    assert.equal(parseForceFlag('').size, 0);
    assert.equal(parseForceFlag(undefined).size, 0);
    assert.equal(parseForceFlag(null).size, 0);
  });

  it('parses bare siteKey with default reason', () => {
    const m = parseForceFlag('futuretools');
    assert.equal(m.get('futuretools'), 'manual-override');
  });

  it('parses siteKey:reason pairs', () => {
    const m = parseForceFlag('futuretools:rebrand,aivalley:test-rerun');
    assert.equal(m.get('futuretools'), 'rebrand');
    assert.equal(m.get('aivalley'), 'test-rerun');
  });

  it('rejects --force all', () => {
    assert.throws(() => parseForceFlag('all'), /not supported/);
    assert.throws(() => parseForceFlag('futuretools,all'), /not supported/);
  });

  it('preserves multi-colon reasons', () => {
    const m = parseForceFlag('futuretools:reason:with:colons');
    assert.equal(m.get('futuretools'), 'reason:with:colons');
  });
});

// --- adapterTypeForBucket --------------------------------------------------

describe('adapterTypeForBucket', () => {
  it('maps each known bucket to the right adapter family', () => {
    assert.equal(adapterTypeForBucket('generic-ready'), 'generic');
    assert.equal(adapterTypeForBucket('recipe-ready'), 'recipe');
    assert.equal(adapterTypeForBucket('provider-ready'), 'provider');
    assert.equal(adapterTypeForBucket('custom-adapter-needed'), 'site-specific');
    assert.equal(adapterTypeForBucket('manual-review'), 'skipped');
    assert.equal(adapterTypeForBucket('dead'), 'skipped');
    assert.equal(adapterTypeForBucket('unknown-bucket'), 'skipped');
  });
});

// --- productHash -----------------------------------------------------------

describe('productHash', () => {
  it('returns a 12-char hex slice', () => {
    const h = productHash(PRODUCT);
    assert.equal(h.length, 12);
    assert.match(h, /^[a-f0-9]{12}$/);
  });

  it('is stable for the same input', () => {
    assert.equal(productHash(PRODUCT), productHash({ ...PRODUCT }));
  });

  it('differs for different products', () => {
    const a = productHash(PRODUCT);
    const b = productHash({ ...PRODUCT, name: 'Other' });
    assert.notEqual(a, b);
  });
});

// --- loadSubmissionMap / recordResult --------------------------------------

describe('tracker dedup map', () => {
  it('returns empty map when file missing', () => {
    const { dir, path } = tmpFile();
    try {
      const m = loadSubmissionMap(path);
      assert.equal(m.size, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('round-trips records via recordResult and loadSubmissionMap', async () => {
    const { dir, path } = tmpFile();
    try {
      const hash = productHash(PRODUCT);
      await recordResult(path, {
        targetKey: 'futuretools',
        adapterType: 'recipe',
        status: 'submitted',
        code: 'OK',
        submittedAt: new Date().toISOString(),
        productHash: hash,
        forced: false,
        forceReason: null,
        evidence: null,
      });
      const m = loadSubmissionMap(path);
      assert.equal(m.get(`futuretools::${hash}`), 'submitted');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- filterAndSort ---------------------------------------------------------

describe('filterAndSort', () => {
  const targets = [
    mkTarget({ siteKey: 'a', value_tier: 3, category: 'cat-x' }),
    mkTarget({ siteKey: 'b', value_tier: 1, category: 'cat-y' }),
    mkTarget({ siteKey: 'c', value_tier: 2, category: 'cat-x' }),
  ];

  it('sorts by value_tier ascending by default', () => {
    const out = filterAndSort(targets, {});
    assert.deepEqual(out.map((t) => t.siteKey), ['b', 'c', 'a']);
  });

  it('filters by category', () => {
    const out = filterAndSort(targets, { category: 'cat-x' });
    assert.deepEqual(out.map((t) => t.siteKey).sort(), ['a', 'c']);
  });

  it('filters by priority high → tier 1', () => {
    const out = filterAndSort(targets, { priority: 'high' });
    assert.deepEqual(out.map((t) => t.siteKey), ['b']);
  });

  it('respects limit AFTER sorting', () => {
    const out = filterAndSort(targets, { limit: 2 });
    assert.deepEqual(out.map((t) => t.siteKey), ['b', 'c']);
  });
});

// --- prepareTargets / loadTriageReport -------------------------------------

describe('triage source loading', () => {
  it('prepareTargets normalises bucket → adapterType', () => {
    const out = prepareTargets([
      { name: 'Future Tools', submit_url: 'x', bucket: 'recipe-ready', code: 'X', value_tier: 1 },
      { name: 'Dead Site', submit_url: 'y', bucket: 'dead', code: 'PAGE_UNREACHABLE', value_tier: 3 },
    ]);
    assert.equal(out[0].adapterType, 'recipe');
    assert.equal(out[0].siteKey, 'future-tools');
    assert.equal(out[1].adapterType, 'skipped');
  });

  it('loadTriageReport throws on missing file', () => {
    assert.throws(() => loadTriageReport('/nonexistent/path.json'), /not found/);
  });

  it('loadTriageReport throws on malformed report', () => {
    const { dir, path } = tmpFile('bad.json');
    try {
      writeFileSync(path, JSON.stringify({ summary: {} }), 'utf-8');
      assert.throws(() => loadTriageReport(path), /no results/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- runBatch (the meat) ---------------------------------------------------

describe('runBatch — 8 scenarios from Task 5 step 4', () => {
  function setup() {
    const { dir, path } = tmpFile();
    return {
      dir,
      submissionsPath: path,
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  }

  it('1. successful submission records status=submitted', async () => {
    const { dir, submissionsPath, cleanup } = setup();
    try {
      const dispatcher = async () => ({ dryRun: true });
      const sleeps = [];
      const { results, summary } = await runBatch(
        [mkTarget({ siteKey: 'site-a' })],
        { product: PRODUCT, submissionsPath },
        { dispatcher, sleepFn: async (ms) => sleeps.push(ms), logger: quietLogger() }
      );
      assert.equal(summary.submitted, 1);
      assert.equal(results[0].status, 'submitted');
      assert.equal(results[0].productHash, productHash(PRODUCT));
      assert.equal(results[0].forced, false);
      // No sleep after a single target.
      assert.equal(sleeps.length, 0);
    } finally {
      cleanup();
    }
  });

  it('2. manual-review bucket is recorded as skipped (status=manual)', async () => {
    const { dir, submissionsPath, cleanup } = setup();
    try {
      const dispatcher = async () => assert.fail('dispatcher should not run');
      const { results, summary } = await runBatch(
        [mkTarget({ bucket: 'manual-review', code: 'CAPTCHA_REQUIRED', reason: 'captcha-required' })],
        { product: PRODUCT, submissionsPath },
        { dispatcher, sleepFn: async () => {}, logger: quietLogger() }
      );
      assert.equal(summary.manual, 1);
      assert.equal(results[0].status, 'manual');
      assert.equal(results[0].adapterType, 'skipped');
      assert.equal(results[0].code, 'CAPTCHA_REQUIRED');
    } finally {
      cleanup();
    }
  });

  it('3. dead bucket is recorded as skipped (status=dead)', async () => {
    const { dir, submissionsPath, cleanup } = setup();
    try {
      const { results, summary } = await runBatch(
        [mkTarget({ bucket: 'dead', code: 'PAGE_UNREACHABLE' })],
        { product: PRODUCT, submissionsPath },
        { dispatcher: async () => assert.fail(), sleepFn: async () => {}, logger: quietLogger() }
      );
      assert.equal(summary.dead, 1);
      assert.equal(results[0].status, 'dead');
    } finally {
      cleanup();
    }
  });

  it('4. retry-exhausted: same code twice → status=failed', async () => {
    const { dir, submissionsPath, cleanup } = setup();
    try {
      let calls = 0;
      const dispatcher = async () => {
        calls += 1;
        const e = new Error('connection reset');
        e.code = 'NETWORK_ERROR';
        throw e;
      };
      const { results, summary } = await runBatch(
        [mkTarget({ siteKey: 'flaky' })],
        { product: PRODUCT, submissionsPath },
        { dispatcher, sleepFn: async () => {}, logger: quietLogger() }
      );
      // First failure → retry once (same-code limit allows 1 retry) →
      // second NETWORK_ERROR → give up. Total dispatcher invocations = 2.
      assert.equal(calls, 2);
      assert.equal(summary.failed, 1);
      assert.equal(results[0].code, 'NETWORK_ERROR');
    } finally {
      cleanup();
    }
  });

  it('4b. retry on different code: first NETWORK_ERROR → second PAGE_404 (still failed, retried)', async () => {
    const { dir, submissionsPath, cleanup } = setup();
    try {
      let calls = 0;
      const dispatcher = async () => {
        calls += 1;
        const codes = ['NETWORK_ERROR', 'PAGE_404'];
        const e = new Error('boom');
        e.code = codes[calls - 1];
        throw e;
      };
      const { results } = await runBatch(
        [mkTarget({ siteKey: 'shifty' })],
        { product: PRODUCT, submissionsPath },
        { dispatcher, sleepFn: async () => {}, logger: quietLogger() }
      );
      // First NETWORK_ERROR triggers retry; second is a different code, so
      // we record that. Total calls = 2.
      assert.equal(calls, 2);
      assert.equal(results[0].code, 'PAGE_404');
    } finally {
      cleanup();
    }
  });

  it('5. dedup hit (already submitted, no force) → skipped with reason=already-submitted', async () => {
    const { dir, submissionsPath, cleanup } = setup();
    try {
      const hash = productHash(PRODUCT);
      await recordResult(submissionsPath, {
        targetKey: 'futuretools',
        adapterType: 'recipe',
        status: 'submitted',
        code: 'OK',
        submittedAt: new Date().toISOString(),
        productHash: hash,
        forced: false,
        forceReason: null,
        evidence: null,
      });
      let dispatched = false;
      const dispatcher = async () => { dispatched = true; return {}; };
      const { results, summary } = await runBatch(
        [mkTarget({ siteKey: 'futuretools', bucket: 'recipe-ready' })],
        { product: PRODUCT, submissionsPath },
        { dispatcher, sleepFn: async () => {}, logger: quietLogger() }
      );
      assert.equal(dispatched, false);
      assert.equal(summary.skipped, 1);
      assert.equal(results[0].code, 'ALREADY_SUBMITTED');
      assert.equal(results[0].reason, 'already-submitted');
      assert.equal(results[0].forced, false);
    } finally {
      cleanup();
    }
  });

  it('6. dedup hit + --force → executes, forced=true, forceReason set', async () => {
    const { dir, submissionsPath, cleanup } = setup();
    try {
      const hash = productHash(PRODUCT);
      await recordResult(submissionsPath, {
        targetKey: 'futuretools',
        adapterType: 'recipe',
        status: 'submitted',
        code: 'OK',
        submittedAt: new Date().toISOString(),
        productHash: hash,
        forced: false,
        forceReason: null,
        evidence: null,
      });
      let dispatched = false;
      const dispatcher = async () => { dispatched = true; return { dryRun: true }; };
      const forceMap = parseForceFlag('futuretools:rebrand');
      const { results, summary } = await runBatch(
        [mkTarget({ siteKey: 'futuretools', bucket: 'recipe-ready' })],
        { product: PRODUCT, submissionsPath, forceMap },
        { dispatcher, sleepFn: async () => {}, logger: quietLogger() }
      );
      assert.equal(dispatched, true);
      assert.equal(summary.submitted, 1);
      assert.equal(results[0].forced, true);
      assert.equal(results[0].forceReason, 'rebrand');
    } finally {
      cleanup();
    }
  });

  it('7. CAPTCHA_REQUIRED is fail-fast — never retried', async () => {
    const { dir, submissionsPath, cleanup } = setup();
    try {
      let calls = 0;
      const dispatcher = async () => {
        calls += 1;
        const e = new Error('Cloudflare turnstile detected');
        e.code = 'CAPTCHA_REQUIRED';
        throw e;
      };
      const { results, summary } = await runBatch(
        [mkTarget({ siteKey: 'captcha-site' })],
        { product: PRODUCT, submissionsPath },
        { dispatcher, sleepFn: async () => {}, logger: quietLogger() }
      );
      assert.equal(calls, 1, 'CAPTCHA must not retry');
      assert.equal(summary.failed, 1);
      assert.equal(results[0].code, 'CAPTCHA_REQUIRED');
    } finally {
      cleanup();
    }
  });

  it('8. multi-target run sleeps between sites (rate limit DI)', async () => {
    const { dir, submissionsPath, cleanup } = setup();
    try {
      const dispatcher = async () => ({ dryRun: true });
      const sleeps = [];
      const targets = [
        mkTarget({ siteKey: 'a' }),
        mkTarget({ siteKey: 'b' }),
        mkTarget({ siteKey: 'c' }),
      ];
      // Force rng to lower bound for deterministic delay.
      await runBatch(
        targets,
        { product: PRODUCT, submissionsPath },
        { dispatcher, sleepFn: async (ms) => sleeps.push(ms), rng: () => 0, logger: quietLogger() }
      );
      // 3 targets → 2 inter-target sleeps.
      assert.equal(sleeps.length, 2);
      // With rng=0, every sleep is exactly the minimum (60s).
      assert.ok(sleeps.every((ms) => ms === 60_000), `sleeps were ${sleeps}`);
    } finally {
      cleanup();
    }
  });
});

// --- Result schema ---------------------------------------------------------

describe('result record schema', () => {
  it('every record has the canonical fields', async () => {
    const { dir, path } = tmpFile();
    try {
      const dispatcher = async () => ({ dryRun: true });
      const { results } = await runBatch(
        [mkTarget()],
        { product: PRODUCT, submissionsPath: path, dryRun: true },
        { dispatcher, sleepFn: async () => {}, logger: quietLogger() }
      );
      const r = results[0];
      const required = [
        'targetKey', 'adapterType', 'status', 'code', 'submittedAt',
        'evidence', 'productHash', 'forced', 'forceReason', 'reason',
      ];
      for (const k of required) {
        assert.ok(k in r, `result missing field: ${k}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
