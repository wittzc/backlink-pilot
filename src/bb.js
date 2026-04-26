// bb.js — bb-browser execution layer
// Wraps bb-browser CLI as subprocess calls, exposes Playwright-like page API

import { execFileSync } from 'child_process';

let _bbTimeout = 30000;

function setBbTimeout(ms) {
  if (ms && ms > 0) _bbTimeout = ms;
}

function bb(...args) {
  try {
    const output = execFileSync('bb-browser', args, {
      encoding: 'utf-8',
      timeout: _bbTimeout,
    }).trim();
    if (/^错误[:：]/.test(output)) throw new Error(output);
    return output;
  } catch (e) {
    const msg = e.stderr?.trim() || e.message;
    if (msg.includes('ECONNREFUSED') || msg.includes('No page target') || msg.includes('connect')) {
      throw new Error(
        `bb-browser cannot connect to Chrome. Make sure it is running:\n` +
        `  1. Run: bb-browser status\n` +
        `  2. If no Chrome is running: bb-browser open about:blank\n` +
        `  3. Try again`
      );
    }
    if (msg.includes('超时') || msg.includes('timeout') || msg.includes('ETIMEDOUT') || e.killed) {
      throw new Error(
        `bb-browser command timed out (${args.join(' ')}). Chrome may be unresponsive.\n` +
        `  Try: kill the Chrome process and restart with bb-browser open about:blank`
      );
    }
    throw new Error(`bb-browser ${args[0]}: ${msg}`);
  }
}

function escapeJs(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

function activeTabIndex() {
  const list = bb('tab', 'list');
  const match = list.match(/\* \[(\d+)\]/);
  return match ? match[1] : null;
}

/**
 * Check if bb-browser is available on the system
 */
export function isBbAvailable() {
  try {
    execFileSync('which', ['bb-browser'], { encoding: 'utf-8' });
    return true;
  } catch { return false; }
}

/**
 * Playwright-like page wrapper around bb-browser CLI
 */
export class BbPage {
  constructor(config = {}) {
    this._config = config;
    this._tabId = null;
    this._openedTabs = []; // track tabs for cleanup

    // Apply timeout from config
    if (config.browser?.timeout) setBbTimeout(config.browser.timeout);

    // Verify Chrome is reachable — use 'tab list' instead of 'status'
    // because 'status' can return "running" even when commands timeout
    try {
      bb('tab', 'list');
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('超时') || msg.includes('timeout') || msg.includes('Timeout')) {
        throw new Error(
          `bb-browser Chrome is not responding (commands timeout).\n` +
          `  Try restarting Chrome:\n` +
          `    1. Kill the managed Chrome: kill $(cat ~/.bb-browser/browser/cdp-port 2>/dev/null && lsof -ti :19825)\n` +
          `    2. Relaunch: bb-browser open about:blank\n` +
          `    3. Retry your command.`
        );
      }
      throw new Error(
        `bb-browser Chrome is not running.\n` +
        `  Start it with: bb-browser open about:blank\n` +
        `  Then retry your command.`
      );
    }
  }

  // Call bb-browser with --tab <tabId> when we have an active tab
  _bb(...args) {
    if (this._tabId) return bb(...args, '--tab', this._tabId);
    return bb(...args);
  }

  async goto(url, _opts = {}) {
    const result = bb('open', url, '--tab');
    // Extract tabId from output like "Tab ID: XXXX"
    const tabMatch = result.match(/Tab ID:\s*(\S+)/);
    if (tabMatch) {
      this._tabId = tabMatch[1];
      this._openedTabs.push({ id: this._tabId, index: activeTabIndex() });
    }
    // Poll snapshot until page has meaningful content (max 12s)
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1500));
      let snap = '';
      try {
        snap = this._bb('snapshot', '-i');
      } catch {
        continue;
      }
      // Page is ready when snapshot has more than just header lines
      if (snap.length > 200) break;
    }
  }

  /**
   * Close all tabs opened during this session
   */
  async cleanup() {
    for (const tab of [...this._openedTabs].reverse()) {
      if (tab.index !== null && tab.index !== undefined) {
        try { bb('tab', 'close', String(tab.index)); continue; } catch {}
      }
      try { bb('tab', 'close', tab.id); } catch {}
    }
    this._openedTabs = [];
  }

  async fill(selectorOrRef, value) {
    if (selectorOrRef.startsWith('@')) {
      this._bb('fill', selectorOrRef, value);
    } else {
      // CSS selector — find element via eval, then use ref from snapshot
      const ref = await this._resolveRef(selectorOrRef);
      if (ref) this._bb('fill', ref, value);
      else throw new Error(`Element not found: ${selectorOrRef}`);
    }
  }

  async click(selectorOrRef) {
    if (selectorOrRef.startsWith('@')) {
      this._bb('click', selectorOrRef);
    } else {
      // CSS selector — use evalClick with full user-event simulation
      // This dispatches mousedown/mouseup/click to work with React/Vue components
      await this.evalClickReal(selectorOrRef);
    }
  }

  async type(selectorOrRef, text, _opts = {}) {
    // bb-browser fill handles typing in real browser
    await this.fill(selectorOrRef, text);
  }

  async textContent(selector) {
    return this._bb('eval', `document.querySelector('${escapeJs(selector)}')?.textContent || ''`);
  }

  async content() {
    return this._bb('eval', 'document.documentElement.outerHTML');
  }

  url() {
    return this._bb('eval', 'window.location.href');
  }

  async screenshot(path) {
    if (path) this._bb('screenshot', path);
    else this._bb('screenshot');
  }

  async scroll(direction = 'down', px = 1000) {
    this._bb('scroll', direction, String(px));
  }

  /**
   * Get interactive snapshot — returns parsed accessibility tree text
   */
  async snapshot() {
    return this._bb('snapshot', '-i');
  }

  /**
   * Playwright-compatible $(selector) — returns BbElementHandle or null
   */
  async $(selector) {
    // Handle Playwright-specific :has-text() selector
    if (selector.includes(':has-text(')) {
      return this._queryHasText(selector);
    }
    const exists = this._bb('eval',
      `!!document.querySelector('${escapeJs(selector)}')`);
    if (exists === 'true') return new BbElementHandle(this, selector);
    return null;
  }

  /**
   * Playwright-compatible locator(selector)
   */
  locator(selector) {
    return new BbLocator(this, selector);
  }

  // --- Internal helpers ---

  async _resolveRef(selector) {
    // Take snapshot and find matching element ref
    const snap = await this.snapshot();
    // Try direct eval to check existence first
    const exists = this._bb('eval',
      `!!document.querySelector('${escapeJs(selector)}')`);
    if (exists !== 'true') return null;

    // Use eval to click/fill by selector directly
    // bb-browser supports CSS selectors via eval workaround
    return null; // fall through to eval-based approach
  }

  async _queryHasText(selector) {
    // Parse "button:has-text("Submit")" → tag=button, text=Submit
    const match = selector.match(/^(\w+):has-text\(["'](.+?)["']\)$/);
    if (!match) return null;
    const [, tag, text] = match;
    const exists = this._bb('eval',
      `!!Array.from(document.querySelectorAll('${tag}')).find(el => el.textContent.includes('${escapeJs(text)}'))`);
    if (exists === 'true') return new BbElementHandle(this, selector, { tag, text });
    return null;
  }

  /**
   * Execute JS directly in page and fill/click by CSS selector
   */
  async evalFill(selector, value) {
    this._bb('eval', `(() => {
      const el = document.querySelector('${escapeJs(selector)}');
      if (!el) return;
      el.focus();
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, '${escapeJs(value)}');
      else el.value = '${escapeJs(value)}';
      el.dispatchEvent(new Event('input', {bubbles: true}));
      el.dispatchEvent(new Event('change', {bubbles: true}));
    })()`);
  }

  async evalClick(selector) {
    this._bb('eval', `document.querySelector('${escapeJs(selector)}')?.click()`);
  }

  /**
   * Click with full user-event simulation (mousedown → mouseup → click)
   * Required for React/Vue components that don't respond to .click()
   */
  async evalClickReal(selector) {
    this._bb('eval', `(() => {
      const el = document.querySelector('${escapeJs(selector)}');
      if (!el) return;
      el.dispatchEvent(new MouseEvent('mousedown', {bubbles:true,cancelable:true}));
      el.dispatchEvent(new MouseEvent('mouseup', {bubbles:true,cancelable:true}));
      el.dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true}));
      if (el.type === 'radio' || el.type === 'checkbox') {
        el.checked = el.type === 'radio' ? true : !el.checked;
        el.dispatchEvent(new Event('change', {bubbles:true}));
        el.dispatchEvent(new Event('input', {bubbles:true}));
      }
    })()`);
  }

  async evalClickByText(tag, text) {
    this._bb('eval', `Array.from(document.querySelectorAll('${tag}')).find(el => el.textContent.includes('${escapeJs(text)}'))?.click()`);
  }
}

/**
 * Element handle wrapping bb-browser eval calls
 */
export class BbElementHandle {
  constructor(page, selector, opts = {}) {
    this._page = page;
    this._selector = selector;
    this._tag = opts.tag;
    this._text = opts.text;
  }

  async isVisible() {
    if (this._tag && this._text) {
      return this._page._bb('eval',
        `(() => {
          const el = Array.from(document.querySelectorAll('${this._tag}')).find(e => e.textContent.includes('${escapeJs(this._text)}'));
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })()`
      ) === 'true';
    }
    return this._page._bb('eval',
      `(() => {
        const el = document.querySelector('${escapeJs(this._selector)}');
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })()`
    ) === 'true';
  }

  async textContent() {
    if (this._tag && this._text) {
      return this._page._bb('eval',
        `Array.from(document.querySelectorAll('${this._tag}')).find(e => e.textContent.includes('${escapeJs(this._text)}'))?.textContent || ''`);
    }
    return this._page._bb('eval',
      `document.querySelector('${escapeJs(this._selector)}')?.textContent || ''`);
  }

  async getAttribute(attr) {
    return this._page._bb('eval',
      `document.querySelector('${escapeJs(this._selector)}')?.getAttribute('${escapeJs(attr)}') || null`);
  }

  async click() {
    if (this._tag && this._text) {
      await this._page.evalClickByText(this._tag, this._text);
    } else {
      await this._page.evalClickReal(this._selector);
    }
  }

  async fill(value) {
    await this._page.evalFill(this._selector, value);
  }

  async evaluate(fn) {
    // Simple evaluate — runs fn as string with el as argument
    return this._page._bb('eval',
      `(${fn.toString()})(document.querySelector('${escapeJs(this._selector)}'))`);
  }
}

/**
 * Locator wrapping bb-browser eval calls
 */
export class BbLocator {
  constructor(page, selector) {
    this._page = page;
    this._selector = selector;
  }

  first() {
    return new BbElementHandle(this._page, this._selector);
  }

  async all() {
    const countStr = this._page._bb('eval',
      `document.querySelectorAll('${escapeJs(this._selector)}').length`);
    const count = parseInt(countStr, 10) || 0;
    return Array.from({ length: count }, (_, i) =>
      new BbElementHandle(this._page,
        `document.querySelectorAll('${escapeJs(this._selector)}')[${i}]`)
    );
  }

  async isVisible() {
    return this._page._bb('eval',
      `(() => {
        const el = document.querySelector('${escapeJs(this._selector)}');
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })()`
    ) === 'true';
  }

  async fill(value) {
    await this._page.evalFill(this._selector, value);
  }

  async click() {
    await this._page.evalClickReal(this._selector);
  }
}
