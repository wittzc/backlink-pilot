import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStatsFromYaml,
  replacePlaceholders,
} from '../scripts/update-readme-stats.js';

const SAMPLE_YAML = `
overseas_ai_directories:
  - name: Alpha
    submit_url: https://alpha.test/
    type: form
    auto: yes

  - name: Bravo
    submit_url: https://bravo.test/
    type: form
    auto: no
    status: dead

  - name: Charlie
    submit_url: https://charlie.test/
    type: form
    auto: manual

  - name: Delta
    submit_url: https://delta.test/
    type: form
    auto: yes
    status: paid

chinese_general:
  - name: Echo
    submit_url: https://echo.test/
    type: form
    auto: yes
`;

describe('computeStatsFromYaml', () => {
  it('counts entries across all categories', () => {
    const stats = computeStatsFromYaml(SAMPLE_YAML);
    assert.equal(stats.total, 5);
  });

  it('treats `auto: yes` (string) as auto-yes — YAML 1.2 does not coerce yes/no', () => {
    const stats = computeStatsFromYaml(SAMPLE_YAML);
    assert.equal(stats['auto-yes'], 3); // Alpha, Delta, Echo
  });

  it('counts auto-no, auto-manual, dead, paid correctly', () => {
    const stats = computeStatsFromYaml(SAMPLE_YAML);
    assert.equal(stats['auto-no'], 1); // Bravo
    assert.equal(stats['auto-manual'], 1); // Charlie
    assert.equal(stats.dead, 1);
    assert.equal(stats.paid, 1);
  });

  it('also treats boolean true/false as auto-yes/auto-no (YAML 1.1 compat)', () => {
    const yamlV11 = `
foo:
  - name: X
    submit_url: https://x.test
    auto: true
  - name: Y
    submit_url: https://y.test
    auto: false
`;
    const stats = computeStatsFromYaml(yamlV11);
    assert.equal(stats['auto-yes'], 1);
    assert.equal(stats['auto-no'], 1);
  });

  it('skips entries without submit_url', () => {
    const yaml = `
foo:
  - name: NoUrl
    auto: yes
  - name: Valid
    submit_url: https://valid.test
    auto: yes
`;
    const stats = computeStatsFromYaml(yaml);
    assert.equal(stats.total, 1);
  });
});

describe('replacePlaceholders', () => {
  const stats = { total: 258, 'auto-yes': 180, dead: 45, paid: 1 };

  it('replaces a single placeholder', () => {
    const text = 'We have <!-- stats:total -->999<!-- /stats --> sites';
    const { out, replaced } = replacePlaceholders(text, stats);
    assert.equal(out, 'We have <!-- stats:total -->258<!-- /stats --> sites');
    assert.equal(replaced, 1);
  });

  it('replaces multiple placeholders in one document', () => {
    const text =
      '<!-- stats:total -->X<!-- /stats --> sites — <!-- stats:auto-yes -->Y<!-- /stats --> auto';
    const { out, replaced } = replacePlaceholders(text, stats);
    assert.equal(replaced, 2);
    assert.match(out, /258/);
    assert.match(out, /180/);
  });

  it('preserves text without placeholders', () => {
    const text = 'No placeholders here.';
    const { out, replaced } = replacePlaceholders(text, stats);
    assert.equal(out, text);
    assert.equal(replaced, 0);
  });

  it('leaves unknown keys untouched', () => {
    const text = '<!-- stats:nonexistent -->42<!-- /stats -->';
    const { out, replaced } = replacePlaceholders(text, stats);
    assert.equal(out, text);
    assert.equal(replaced, 0);
  });

  it('handles whitespace inside placeholder tags', () => {
    const text = '<!--  stats:total  -->old<!--  /stats  -->';
    const { out } = replacePlaceholders(text, stats);
    assert.match(out, /258/);
  });
});
