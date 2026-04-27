#!/usr/bin/env node
// backlink-pilot CLI entry point

import { Command } from 'commander';
import { loadConfig } from './config.js';
import { scout } from './scout/discover.js';
import { submit } from './submit.js';
import { generateAwesomeIssue } from './awesome/templates.js';
import { pingIndexNow } from './indexnow.js';
import { showStatus } from './tracker.js';
import { forceUpdate } from './bb-update.js';
import { pruneDead } from './prune-dead.js';
import { markDead, markManual, markDone } from './targets.js';
import { showStats } from './stats.js';
import { runDoctor } from './doctor.js';
import { cleanupScreenshots, cleanupLocks } from './utils/cleanup.js';
import { triageTargets } from './triage.js';
import { runBatchCli } from './batch-submit.js';

const program = new Command();

program
  .name('backlink-pilot')
  .description('Automated backlink submission toolkit for indie hackers')
  .version('2.2.0');

program
  .command('scout <url>')
  .description('Discover submit pages and form fields on a site')
  .option('--deep', 'Follow links to find hidden submit pages')
  .option('--screenshot <path>', 'Save screenshot of submit page')
  .option('--engine <engine>', 'Browser engine (bb required; playwright removed in v2.2)')
  .action(async (url, opts) => {
    const config = await loadConfig();
    if (opts.engine) config._engine = opts.engine;
    await scout(url, { ...opts, config });
  });

program
  .command('submit <site>')
  .description('Submit to a directory site (name or URL for generic)')
  .option('--dry-run', 'Show what would be submitted without actually doing it')
  .option('--screenshot <path>', 'Save screenshot after submission')
  .option('--engine <engine>', 'Browser engine (bb required; playwright removed in v2.2)')
  .option('--json', 'Output machine-readable JSON result (for Claude agent use)')
  .action(async (site, opts) => {
    const config = await loadConfig();
    if (opts.engine) config._engine = opts.engine;
    await submit(site, { ...opts, config });
  });

program
  .command('awesome <repo>')
  .description('Generate GitHub Issue body for an awesome-list submission')
  .option('--open', 'Open the issue creation page in browser')
  .action(async (repo, opts) => {
    const config = await loadConfig();
    await generateAwesomeIssue(repo, { ...opts, config });
  });

program
  .command('indexnow <url>')
  .description('Ping Bing/Yandex about a new or updated page')
  .option('--key <key>', 'IndexNow API key')
  .action(async (url, opts) => {
    const config = await loadConfig();
    await pingIndexNow(url, { ...opts, config });
  });

program
  .command('status')
  .description('Show submission tracking status (directory + blog comments)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    await showStatus(opts);
  });

program
  .command('stats')
  .description('Show aggregated submission statistics')
  .option('--timing', 'Include p50/p95 per-submission timing')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    await showStats(opts);
  });

program
  .command('doctor')
  .description('Check environment health (Node, bb-browser, Chrome, config)')
  .action(async () => {
    await runDoctor();
  });

program
  .command('bb-update')
  .description('Update bb-browser community site adapters')
  .action(() => {
    forceUpdate();
  });

program
  .command('prune-dead')
  .description('Probe targets.yaml URLs and mark unreachable ones as status: dead')
  .option('--apply', 'Write changes to targets.yaml (default: dry-run)')
  .option('--json', 'Output structured JSON (machine-readable)')
  .action(async (opts) => {
    await pruneDead({ apply: !!opts.apply, json: !!opts.json });
  });

program
  .command('triage')
  .description('Classify targets.yaml sites before batch submission')
  .option('--browser', 'Use bb-browser snapshots instead of HTTP-only heuristics')
  .option('--limit <n>', 'Only scan the first N matching targets')
  .option('--category <key>', 'Only scan one targets.yaml category key')
  .option('--include-manual', 'Include non-auto targets too')
  .option('--json', 'Output machine-readable JSON')
  .option('--output <path>', 'Write JSON report to a file')
  .action(async (opts) => {
    const config = await loadConfig();
    await triageTargets({
      config,
      browser: !!opts.browser,
      limit: opts.limit ? parseInt(opts.limit, 10) : null,
      category: opts.category || null,
      includeManual: !!opts.includeManual,
      json: !!opts.json,
      outputPath: opts.output || null,
    });
  });

program
  .command('mark-dead <site>')
  .description('Mark a site as dead in targets.yaml')
  .option('--yes', 'Skip confirmation prompt')
  .action(async (site, opts) => {
    if (!opts.yes) {
      console.log(`Mark "${site}" as dead in targets.yaml? Run with --yes to confirm.`);
      return;
    }
    try {
      const entry = markDead(site);
      console.log(`✓ Marked "${entry.name}" as dead in targets.yaml`);
    } catch (e) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
  });

program
  .command('mark-manual <site>')
  .description('Mark a site as manual-only in targets.yaml (sets auto: manual)')
  .option('--yes', 'Skip confirmation prompt')
  .action(async (site, opts) => {
    if (!opts.yes) {
      console.log(`Mark "${site}" as manual in targets.yaml? Run with --yes to confirm.`);
      return;
    }
    try {
      const entry = markManual(site);
      console.log(`✓ Marked "${entry.name}" as manual in targets.yaml`);
    } catch (e) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
  });

program
  .command('mark-done <site>')
  .description('Manually record a successful submission in submissions.yaml')
  .action(async (site) => {
    await markDone(site);
    console.log(`✓ Recorded "${site}" as submitted in submissions.yaml`);
  });

program
  .command('batch-submit')
  .description('Run the directory batch executor (consumes triage report or runs live)')
  .option('--dry-run', 'Pass dryRun=true to every adapter; no real submissions')
  .option('--yes', 'Confirm real (non-dry-run) submission; required without --dry-run')
  .option('--limit <n>', 'Cap the number of targets executed this run (real runs default to 5)')
  .option('--category <key>', 'Only execute targets in this targets.yaml category')
  .option('--priority <level>', 'Filter by priority (high|medium|low → tier 1|2|3)')
  .option('--value-tier <n>', 'Filter by value tier (1|2|3); default order is tier-1 first')
  .option('--force <list>', 'Force re-submit comma-separated siteKey[:reason] pairs (no "all")')
  .option('--triage-source <path>', 'Use a saved triage JSON instead of running triage live')
  .option('--submissions-path <path>', 'Override submissions.yaml path')
  .action(async (opts) => {
    try {
      await runBatchCli({
        dryRun: !!opts.dryRun,
        yes: !!opts.yes,
        limit: opts.limit ? parseInt(opts.limit, 10) : null,
        category: opts.category || null,
        priority: opts.priority || null,
        valueTier: opts.valueTier ? parseInt(opts.valueTier, 10) : null,
        force: opts.force || '',
        triageSource: opts.triageSource || null,
        submissionsPath: opts.submissionsPath || null,
      });
    } catch (err) {
      console.error('batch-submit failed:', err.message);
      process.exit(1);
    }
  });

program
  .command('cleanup')
  .description('Clean old screenshots or stale lock files')
  .option('--keep-days <n>', 'Delete screenshots older than N days', '30')
  .option('--locks', 'Remove stale lock files (>60s old)')
  .action((opts) => {
    if (opts.locks) {
      cleanupLocks();
    } else {
      cleanupScreenshots(parseInt(opts.keepDays, 10));
    }
  });

program.parse();
