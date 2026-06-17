#!/usr/bin/env node
// submit-tinylaunch.js — fill (and optionally submit) the TinyLaunch
// "New Startup" form via raw CDP over the bb-browser Chrome.
//
// WHY a bespoke script instead of recipes/tinylaunch.yaml:
//   The form needs three things the selector→value recipe engine can't express:
//   (1) logo is a REQUIRED file upload — bb-browser has no upload command and
//       page JS can't set input.files; only CDP DOM.setFileInputFiles works.
//   (2) Description is a contenteditable (ProseMirror) rich-text editor — needs
//       CDP Input.insertText, not a value setter.
//   (3) React controlled inputs ignore plain .value writes; you must use the
//       native setter + dispatch 'input' or the form submits empty.
//   See docs/research/2026-06-04-launch平台半自动接手笔记.md (2026-06-18 entry).
//
// PREREQUISITES (one-time, manual — NOT done by this script):
//   - Logged into TinyLaunch in the bb-browser Chrome.
//   - Maker Profile saved (unlocks Startups). Handle must be UNIQUE — a taken
//     handle fails silently as "回空". happyhorseai/happyhorse_ai are taken.
//   - bb-browser Chrome running with CDP at 127.0.0.1:19825
//     (bb-browser daemon shutdown && bb-browser open about:blank if it 503s).
//
// Usage:
//   node scripts/submit-tinylaunch.js --logo <path> --category "<TinyLaunch category>" [--config config.yaml] [--submit]
//   (without --submit it fills everything, screenshots, and STOPS before Create Startup)

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(k);

const CDP_HTTP = 'http://127.0.0.1:19825';
const configPath = opt('--config', 'config.yaml');
const logoPath = opt('--logo');
const category = opt('--category', 'SaaS & Tools');
const doSubmit = has('--submit');
const shotPath = opt('--screenshot', 'tmp_assets/tl-filled.png');

if (!logoPath || !fs.existsSync(logoPath)) {
  console.error('ERR: --logo <path> is required and must exist (logo is a mandatory upload).');
  process.exit(1);
}
const cfg = parseYaml(fs.readFileSync(configPath, 'utf8'));
const p = cfg.product || {};
const name = (p.name || '').slice(0, 30);
const tagline = (p.description || '').slice(0, 60);
const url = p.url || p.base_url || '';
const description = (p.long_description || p.description || '').trim();
if (!name || !url || !description) {
  console.error('ERR: config product is missing name/url/long_description.', { name, url, hasDesc: !!description });
  process.exit(1);
}
console.log('Product:', { name, taglineLen: tagline.length, url, descLen: description.length, category, submit: doSubmit });

const list = await (await fetch(`${CDP_HTTP}/json`)).json();
let page = list.find(t => t.type === 'page' && t.url.includes('/dashboard/startups/new'))
        || list.find(t => t.type === 'page' && t.url.includes('tinylaunch'));
if (!page) { console.error('ERR: no TinyLaunch page open. Run: bb-browser open https://www.tinylaunch.com/dashboard/startups/new'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id; pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  }
});
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 80));
  return r.result.value;
};

// ensure we're on the new-startup form
if (!page.url.includes('/dashboard/startups/new')) {
  await send('Page.navigate', { url: 'https://www.tinylaunch.com/dashboard/startups/new' });
  await new Promise(r => setTimeout(r, 6000));
}
await send('Runtime.enable'); await send('DOM.enable'); await send('Page.enable');

const setText = (sel, val) => `(()=>{const el=document.querySelector(${JSON.stringify(sel)});const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(el,${JSON.stringify(val)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return el.value})()`;
console.log('name   =', await evalJS(setText('input[name=name]', name)));
console.log('tagline=', await evalJS(setText('input[name=tagline]', tagline)));
console.log('url    =', await evalJS(setText('input[name=url]', url)));

const catSet = await evalJS(`(()=>{const sel=document.querySelector('select[name=category_id]');const opt=[...sel.options].find(o=>o.textContent.trim()===${JSON.stringify(category)});if(!opt)return 'NO-MATCH';const s=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;s.call(sel,opt.value);sel.dispatchEvent(new Event('change',{bubbles:true}));return sel.options[sel.selectedIndex].textContent.trim()})()`);
console.log('category=', catSet);
if (catSet === 'NO-MATCH') console.error('WARN: category not found among options; left unselected. Pass exact --category text.');

await evalJS(`(()=>{const d=document.querySelector('[contenteditable=true]');d.focus();return true})()`);
await send('Input.insertText', { text: description });
console.log('descLen=', await evalJS(`document.querySelector('input[name=description]')?.value?.length || document.querySelector('[contenteditable=true]').innerText.length`));

await evalJS(`(()=>{const cb=document.querySelector('input[type=checkbox]');if(!cb.checked)cb.click();return cb.checked})()`);
console.log('checkbox checked');

const fileNode = await send('Runtime.evaluate', { expression: `document.querySelectorAll('input[type=file]')[0]` });
await send('DOM.setFileInputFiles', { objectId: fileNode.result.objectId, files: [path.resolve(logoPath)] });
await new Promise(r => setTimeout(r, 2500));
console.log('logo blob preview =', await evalJS(`[...document.querySelectorAll('img')].some(i=>i.src.startsWith('blob:'))`));

fs.mkdirSync(path.dirname(shotPath), { recursive: true });
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
console.log('screenshot ->', shotPath);

if (doSubmit) {
  const clicked = await evalJS(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Create Startup');if(!b)return 'no-btn';b.click();return 'clicked'})()`);
  console.log('submit:', clicked);
  await new Promise(r => setTimeout(r, 6000));
  console.log('after-submit url check — verify in: https://www.tinylaunch.com/dashboard/startups');
} else {
  console.log('DRY RUN — form filled, NOT submitted. Review screenshot, then re-run with --submit.');
}
ws.close();
