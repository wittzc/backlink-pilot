import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseDocument } from 'yaml';
import {
  classifyTriage,
  collectTriageTargets,
  computeValueTier,
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

  it('marks forms with required select/radio/file controls as custom-adapter-needed', () => {
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

    assert.equal(result.bucket, 'custom-adapter-needed');
    assert.equal(result.code, 'EXTRA_REQUIRED_FIELDS');
    assert.equal(result.automation, 'adapter');
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
});

describe('triage classification — recipe-ready (Step 1)', () => {
  it('marks targets with an existing recipe as recipe-ready when no hard wall blocks it', () => {
    const result = classifyTriage({
      status: 200,
      bodyText: 'Submit your tool',
      snapshot: `
label [ref=1] "Tool Name"
textbox [ref=2] "Name"
button [ref=3] "Submit"
`,
      dom: { forms: 1, inputs: 1, iframes: [] },
      hasRecipe: true,
    });

    assert.equal(result.bucket, 'recipe-ready');
    assert.equal(result.code, 'RECIPE_AVAILABLE');
    assert.equal(result.automation, 'recipe');
  });

  it('captcha takes precedence over recipe (ADR-007 fail-fast)', () => {
    const result = classifyTriage({
      status: 200,
      bodyText: 'Submit your tool',
      snapshot: `
label [ref=1] "Tool Name"
textbox [ref=2] "Name"
button [ref=3] "Submit"
`,
      dom: { forms: 1, inputs: 1, iframes: ['https://challenges.cloudflare.com/turnstile/v0/api.js'] },
      hasRecipe: true,
    });

    assert.equal(result.bucket, 'manual-review');
    assert.equal(result.reason, 'captcha-required');
    assert.equal(result.code, 'CAPTCHA_REQUIRED');
  });

  it('does not mark recipe-ready when hasRecipe is false', () => {
    const result = classifyTriage({
      status: 200,
      bodyText: 'Submit your tool',
      snapshot: `
label [ref=1] "Tool Name"
textbox [ref=2] "Name"
label [ref=3] "Website URL"
textbox [ref=4] "https://example.com"
label [ref=5] "Description"
textbox [ref=6] "Brief description"
`,
      dom: { forms: 1, inputs: 3, iframes: [] },
      hasRecipe: false,
    });

    assert.notEqual(result.bucket, 'recipe-ready');
  });
});

describe('triage classification — provider-ready (Step 2)', () => {
  it('detects Paperform iframe and sets provider name', () => {
    const result = classifyTriage({
      status: 200,
      bodyText: 'Fill out the form below',
      snapshot: 'link [ref=1] "Submit Tool"',
      dom: { forms: 0, inputs: 0, iframes: ['https://aitool.paperform.co/?embed=1'] },
    });

    assert.equal(result.bucket, 'provider-ready');
    assert.equal(result.code, 'PAPERFORM_IFRAME');
    assert.equal(result.provider, 'paperform');
    assert.equal(result.automation, 'provider-adapter');
  });

  it('detects Tally iframe', () => {
    const result = classifyTriage({
      status: 200,
      bodyText: '',
      snapshot: '',
      dom: { forms: 0, inputs: 0, iframes: ['https://tally.so/embed/abc'] },
    });
    assert.equal(result.bucket, 'provider-ready');
    assert.equal(result.provider, 'tally');
  });

  it('detects Typeform iframe', () => {
    const result = classifyTriage({
      status: 200,
      bodyText: '',
      snapshot: '',
      dom: { forms: 0, inputs: 0, iframes: ['https://form.typeform.com/to/abcd'] },
    });
    assert.equal(result.bucket, 'provider-ready');
    assert.equal(result.provider, 'typeform');
  });

  it('detects Airtable iframe', () => {
    const result = classifyTriage({
      status: 200,
      bodyText: '',
      snapshot: '',
      dom: { forms: 0, inputs: 0, iframes: ['https://airtable.com/embed/shrXYZ'] },
    });
    assert.equal(result.bucket, 'provider-ready');
    assert.equal(result.provider, 'airtable');
  });

  it('does NOT classify body word "totally" as Tally provider (no iframe)', () => {
    const result = classifyTriage({
      status: 200,
      bodyText: 'This is totally a great tool. Mentally stimulating, fundamentally sound.',
      snapshot: '',
      dom: { forms: 0, inputs: 0, iframes: [] },
    });
    assert.notEqual(result.bucket, 'provider-ready');
    assert.notEqual(result.provider, 'tally');
  });

  it('does NOT fall back to generic iframe provider for unrelated embeds (e.g. YouTube)', () => {
    const result = classifyTriage({
      status: 200,
      bodyText: 'Watch our intro video below',
      snapshot: '',
      dom: { forms: 0, inputs: 0, iframes: ['https://www.youtube.com/embed/abc123'] },
    });
    assert.notEqual(result.bucket, 'provider-ready');
  });
});

describe('triage classification — provider_url surface (Task 4)', () => {
  it('surfaces provider_url for Paperform with the actual iframe src', () => {
    const result = classifyTriage({
      status: 200,
      bodyText: '',
      snapshot: '',
      dom: { forms: 0, inputs: 0, iframes: ['https://aitool.paperform.co/?embed=1'] },
    });
    assert.equal(result.bucket, 'provider-ready');
    assert.equal(result.provider, 'paperform');
    assert.equal(result.provider_url, 'https://aitool.paperform.co/?embed=1');
  });

  it('surfaces provider_url for Tally', () => {
    const result = classifyTriage({
      status: 200,
      bodyText: '',
      snapshot: '',
      dom: { forms: 0, inputs: 0, iframes: ['https://tally.so/embed/abc'] },
    });
    assert.equal(result.provider, 'tally');
    assert.equal(result.provider_url, 'https://tally.so/embed/abc');
  });

  it('does not include provider_url when there is no provider iframe', () => {
    const result = classifyTriage({
      status: 200,
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
    assert.notEqual(result.bucket, 'provider-ready');
    assert.equal(result.provider_url, null);
  });

  it('picks the Paperform iframe even when other unrelated iframes are present', () => {
    const result = classifyTriage({
      status: 200,
      bodyText: '',
      snapshot: '',
      dom: {
        forms: 0,
        inputs: 0,
        iframes: [
          'https://www.googletagmanager.com/ns.html?id=GTM-XYZ',
          'https://forms.paperform.co/realform-id?embed=1',
        ],
      },
    });
    assert.equal(result.provider, 'paperform');
    assert.equal(result.provider_url, 'https://forms.paperform.co/realform-id?embed=1');
  });
});

describe('triage classification — captcha detection (Step 3)', () => {
  it('detects Cloudflare Turnstile iframe in DOM iframes', () => {
    const result = classifyTriage({
      status: 200,
      bodyText: 'Submit your tool',
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
        iframes: ['https://challenges.cloudflare.com/turnstile/v0/api.js'],
      },
    });
    assert.equal(result.bucket, 'manual-review');
    assert.equal(result.reason, 'captcha-required');
    assert.equal(result.code, 'CAPTCHA_REQUIRED');
  });

  it('detects hCaptcha via .h-captcha class in HTML', () => {
    const result = classifyTriage({
      status: 200,
      bodyText: 'Submit',
      snapshot: 'label [ref=1] "Name" textbox [ref=2] "x" label [ref=3] "URL" textbox [ref=4] "x" label [ref=5] "Description" textbox [ref=6] "x"',
      dom: { forms: 1, inputs: 3, iframes: [] },
      html: '<form><div class="h-captcha" data-sitekey="abc"></div></form>',
    });
    assert.equal(result.bucket, 'manual-review');
    assert.equal(result.reason, 'captcha-required');
  });

  it('detects reCAPTCHA via .g-recaptcha class in HTML', () => {
    const result = classifyTriage({
      status: 200,
      bodyText: 'Submit',
      snapshot: 'label [ref=1] "Name" textbox [ref=2] "x" label [ref=3] "URL" textbox [ref=4] "x" label [ref=5] "Description" textbox [ref=6] "x"',
      dom: { forms: 1, inputs: 3, iframes: [] },
      html: '<form><div class="g-recaptcha" data-sitekey="abc"></div></form>',
    });
    assert.equal(result.bucket, 'manual-review');
    assert.equal(result.reason, 'captcha-required');
  });

  it('detects recaptcha via script[src*="recaptcha"]', () => {
    const result = classifyTriage({
      status: 200,
      bodyText: 'Submit',
      snapshot: 'label [ref=1] "Name" textbox [ref=2] "x" label [ref=3] "URL" textbox [ref=4] "x" label [ref=5] "Description" textbox [ref=6] "x"',
      dom: { forms: 1, inputs: 3, iframes: [] },
      html: '<script src="https://www.google.com/recaptcha/api.js"></script>',
    });
    assert.equal(result.bucket, 'manual-review');
    assert.equal(result.reason, 'captcha-required');
  });

  it('detects hcaptcha via script[src*="hcaptcha"]', () => {
    const result = classifyTriage({
      status: 200,
      bodyText: 'Submit',
      snapshot: 'label [ref=1] "Name" textbox [ref=2] "x" label [ref=3] "URL" textbox [ref=4] "x" label [ref=5] "Description" textbox [ref=6] "x"',
      dom: { forms: 1, inputs: 3, iframes: [] },
      html: '<script src="https://hcaptcha.com/1/api.js"></script>',
    });
    assert.equal(result.bucket, 'manual-review');
    assert.equal(result.reason, 'captcha-required');
  });

  it('captcha overrides generic-ready even when fields look fine', () => {
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
    assert.equal(result.reason, 'captcha-required');
  });
});

describe('triage classification — login wall (Step 4)', () => {
  it('detects redirect to /login final URL', () => {
    const result = classifyTriage({
      status: 200,
      finalUrl: 'https://site.test/login?redirect=/submit',
      bodyText: 'Sign in to your account',
      snapshot: '',
      dom: { forms: 1, inputs: 2, iframes: [] },
    });
    assert.equal(result.bucket, 'manual-review');
    assert.equal(result.reason, 'login-required');
  });

  it('detects redirect to /signin', () => {
    const result = classifyTriage({
      status: 200,
      finalUrl: 'https://site.test/signin',
      bodyText: 'Welcome',
      snapshot: '',
      dom: { forms: 1, inputs: 2, iframes: [] },
    });
    assert.equal(result.bucket, 'manual-review');
    assert.equal(result.reason, 'login-required');
  });

  it('detects redirect to /signup', () => {
    const result = classifyTriage({
      status: 200,
      finalUrl: 'https://site.test/signup',
      bodyText: 'Create an account',
      snapshot: '',
      dom: { forms: 1, inputs: 2, iframes: [] },
    });
    assert.equal(result.bucket, 'manual-review');
    assert.equal(result.reason, 'login-required');
  });

  it('detects "login required" text on submit page', () => {
    const result = classifyTriage({
      status: 200,
      finalUrl: 'https://site.test/submit',
      bodyText: 'Login required to submit a tool. Please sign in first.',
      snapshot: 'link [ref=1] "Login"',
      dom: { forms: 0, inputs: 0, iframes: [] },
    });
    assert.equal(result.bucket, 'manual-review');
    assert.equal(result.reason, 'login-required');
  });
});

describe('triage classification — paid submission (Step 5)', () => {
  it('detects $ price near submit button text', () => {
    const result = classifyTriage({
      status: 200,
      finalUrl: 'https://site.test/submit',
      bodyText: 'Submit your tool. Pay $29 to get featured. Featured submission required.',
      snapshot: 'button [ref=1] "Submit Tool"',
      dom: { forms: 1, inputs: 3, iframes: [] },
    });
    assert.equal(result.bucket, 'manual-review');
    assert.equal(result.reason, 'paid');
  });

  it('detects "Premium" pricing language', () => {
    const result = classifyTriage({
      status: 200,
      finalUrl: 'https://site.test/submit',
      bodyText: 'Get Premium for $19 to submit. Pay now.',
      snapshot: 'button [ref=1] "Pay Now"',
      dom: { forms: 1, inputs: 3, iframes: [] },
    });
    assert.equal(result.bucket, 'manual-review');
    assert.equal(result.reason, 'paid');
  });

  it('detects "Featured submission" language', () => {
    const result = classifyTriage({
      status: 200,
      finalUrl: 'https://site.test/submit',
      bodyText: 'Featured submission $49 - guaranteed within 24 hours',
      snapshot: 'button [ref=1] "Submit"',
      dom: { forms: 1, inputs: 3, iframes: [] },
    });
    assert.equal(result.bucket, 'manual-review');
    assert.equal(result.reason, 'paid');
  });
});

describe('triage classification — negative cases (no false manual-review)', () => {
  const cleanForm = {
    status: 200,
    finalUrl: 'https://clean.test/submit',
    bodyText: 'Submit your tool to our directory',
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
    html: '<form><input name="url"><textarea></textarea><button>Submit</button></form>',
  };

  it('clean form (no captcha selectors) MUST NOT classify as captcha-required', () => {
    const result = classifyTriage(cleanForm);
    assert.notEqual(result.reason, 'captcha-required');
    assert.notEqual(result.code, 'CAPTCHA_REQUIRED');
  });

  it('clean form (no login URL or text) MUST NOT classify as login-required', () => {
    const result = classifyTriage(cleanForm);
    assert.notEqual(result.reason, 'login-required');
    assert.notEqual(result.code, 'LOGIN_REQUIRED');
  });

  it('clean form (no $ price or payment language) MUST NOT classify as paid', () => {
    const result = classifyTriage(cleanForm);
    assert.notEqual(result.reason, 'paid');
    assert.notEqual(result.code, 'PAID_SUBMISSION');
  });
});

describe('triage classification — value_tier (Step 6)', () => {
  it('returns tier-1 for explicit priority: high', () => {
    assert.equal(computeValueTier({ priority: 'high' }), 1);
  });

  it('returns tier-1 for explicit value_tier: 1', () => {
    assert.equal(computeValueTier({ value_tier: 1 }), 1);
  });

  it('returns tier-2 for priority: medium', () => {
    assert.equal(computeValueTier({ priority: 'medium' }), 2);
  });

  it('returns tier-2 for category overseas_ai_directories', () => {
    assert.equal(computeValueTier({}, 'overseas_ai_directories'), 2);
  });

  it('returns tier-2 for category awesome_lists', () => {
    assert.equal(computeValueTier({}, 'awesome_lists'), 2);
  });

  it('returns tier-3 for unflagged entries in other categories', () => {
    assert.equal(computeValueTier({}, 'overseas_general'), 3);
    assert.equal(computeValueTier({}, 'chinese_general'), 3);
  });

  it('explicit priority overrides category default', () => {
    assert.equal(computeValueTier({ priority: 'high' }, 'overseas_general'), 1);
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

  it('summarizes buckets with backward-compat aliases and tier breakdown', () => {
    const summary = summarizeTriage([
      { bucket: 'generic-ready', value_tier: 2 },
      { bucket: 'generic-ready', value_tier: 3 },
      { bucket: 'recipe-ready', value_tier: 2 },
      { bucket: 'provider-ready', value_tier: 1 },
      { bucket: 'custom-adapter-needed', value_tier: 2 },
      { bucket: 'manual-review', value_tier: 3, reason: 'captcha-required' },
      { bucket: 'dead', value_tier: 3 },
    ]);

    assert.equal(summary.total, 7);
    // New buckets
    assert.equal(summary.buckets['generic-ready'], 2);
    assert.equal(summary.buckets['recipe-ready'], 1);
    assert.equal(summary.buckets['provider-ready'], 1);
    assert.equal(summary.buckets['custom-adapter-needed'], 1);
    assert.equal(summary.buckets['manual-review'], 1);
    assert.equal(summary.buckets['dead'], 1);
    // Backward-compat aliases
    // adapter-needed alias = recipe-ready + custom-adapter-needed
    assert.equal(summary.buckets['adapter-needed'], 2);
    // iframe-provider alias = provider-ready
    assert.equal(summary.buckets['iframe-provider'], 1);
    // Reason breakdown for manual-review
    assert.equal(summary.manual_reasons['captcha-required'], 1);
    // Tier breakdown
    assert.equal(summary.tiers[1], 1);
    assert.equal(summary.tiers[2], 3);
    assert.equal(summary.tiers[3], 3);
    // Bucket × tier matrix
    assert.equal(summary.bucket_by_tier['generic-ready'][2], 1);
    assert.equal(summary.bucket_by_tier['generic-ready'][3], 1);
    assert.equal(summary.bucket_by_tier['provider-ready'][1], 1);
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
