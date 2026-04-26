import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseDocument } from 'yaml';
import {
  classifyTriage,
  collectTriageTargets,
  summarizeTriage,
  writeTriageOutput,
} from '../src/triage.js';

describe('triage classification', () => {
  it('marks simple visible forms as generic-ready', () => {
    const result = classifyTriage({
      status: 200,
      finalUrl: 'https://example.com/submit',
      bodyText: 'Submit your tool',
      snapshot: `
label [ref=1] "Tool Name"
textbox [ref=2] "Name"
label [ref=3] "Website URL"
textbox [ref=4] "https://example.com"
label [ref=5] "Description"
textbox [ref=6] "Brief description"
button [ref=7] "Submit"
`,
      dom: { forms: 1, inputs: 3, iframes: [] },
    });

    assert.equal(result.bucket, 'generic-ready');
    assert.equal(result.code, 'GENERIC_READY');
    assert.equal(result.automation, 'auto');
  });

  it('marks forms with required select/radio/file controls as adapter-needed', () => {
    const result = classifyTriage({
      status: 200,
      bodyText: 'Submit a Tool Category Pricing',
      snapshot: `
label [ref=1] "Tool Name *"
textbox [ref=2] "e.g. ChatGPT"
label [ref=3] "Tool URL *"
textbox [ref=4] "https://example.com"
label [ref=5] "Short Description *"
textbox [ref=6] "Briefly describe it"
label [ref=7] "Category *"
combobox [ref=8] "Select a category"
label [ref=9] "Pricing *"
radio [ref=10] "Free"
button [ref=11] "Submit Tool"
`,
      dom: { forms: 1, inputs: 8, iframes: [] },
    });

    assert.equal(result.bucket, 'adapter-needed');
    assert.equal(result.code, 'EXTRA_REQUIRED_FIELDS');
    assert.equal(result.automation, 'adapter');
  });

  it('marks embedded provider forms as iframe-provider', () => {
    const result = classifyTriage({
      status: 200,
      bodyText: 'Fill out the form below',
      snapshot: 'link [ref=1] "Submit Tool"',
      dom: {
        forms: 0,
        inputs: 0,
        iframes: ['https://aitool.paperform.co/?embed=1'],
      },
    });

    assert.equal(result.bucket, 'iframe-provider');
    assert.equal(result.code, 'PAPERFORM_IFRAME');
    assert.equal(result.automation, 'provider-adapter');
  });

  it('marks fetch failures as retry/manual review instead of no-form', () => {
    const result = classifyTriage({
      status: null,
      finalUrl: 'https://timeout.test/submit',
      bodyText: 'This operation was aborted',
      snapshot: '',
      dom: { forms: 0, inputs: 0, iframes: [] },
    });

    assert.equal(result.bucket, 'manual-review');
    assert.equal(result.code, 'NETWORK_ERROR');
    assert.equal(result.automation, 'manual');
  });

  it('prioritizes captcha/manual review over generic-ready', () => {
    const result = classifyTriage({
      status: 200,
      bodyText: 'Submit your tool recaptcha',
      snapshot: `
label [ref=1] "Tool Name"
textbox [ref=2] "Name"
label [ref=3] "Website URL"
textbox [ref=4] "https://example.com"
label [ref=5] "Description"
textbox [ref=6] "Brief description"
`,
      dom: {
        forms: 1,
        inputs: 3,
        iframes: ['https://www.google.com/recaptcha/api2/anchor'],
      },
    });

    assert.equal(result.bucket, 'manual-review');
    assert.equal(result.code, 'CAPTCHA');
    assert.equal(result.automation, 'manual');
  });
});

describe('triage targets', () => {
  it('collects only auto yes targets by default', () => {
    const doc = parseDocument(`
group:
  - name: Auto Yes
    submit_url: https://auto.test
    auto: yes
  - name: Auto True
    submit_url: https://true.test
    auto: true
  - name: Manual
    submit_url: https://manual.test
    auto: manual
  - name: Dead
    submit_url: https://dead.test
    auto: yes
    status: dead
`);

    const targets = collectTriageTargets(doc);

    assert.deepEqual(targets.map(t => t.entry.name), ['Auto Yes', 'Auto True']);
  });

  it('summarizes buckets for batch planning', () => {
    const summary = summarizeTriage([
      { bucket: 'generic-ready' },
      { bucket: 'generic-ready' },
      { bucket: 'iframe-provider' },
      { bucket: 'manual-review' },
    ]);

    assert.deepEqual(summary, {
      total: 4,
      buckets: {
        'generic-ready': 2,
        'iframe-provider': 1,
        'manual-review': 1,
      },
    });
  });

  it('writes triage JSON output and creates parent directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'triage-output-test-'));
    const outputPath = join(dir, 'reports', 'triage.json');

    try {
      writeTriageOutput(outputPath, {
        mode: 'http',
        summary: { total: 1, buckets: { 'generic-ready': 1 } },
        results: [{ name: 'Example', bucket: 'generic-ready' }],
      });

      const saved = JSON.parse(readFileSync(outputPath, 'utf-8'));
      assert.equal(saved.summary.total, 1);
      assert.equal(saved.results[0].name, 'Example');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
