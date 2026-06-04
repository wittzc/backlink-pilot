# Site Adapters & Awesome-List Targets

## Directory Site Adapters

Site-specific adapters in `src/sites/` (hand-written, highest fidelity):

| Adapter | Command | Notes |
|---------|---------|-------|
| `futuretools` | `submit futuretools` | Future Tools directory |
| `aivalley` | `submit aivalley` | AI Valley (Contact Form 7) |
| `saashub` | `submit saashub` | SaaS directory |
| `uneed` | `submit uneed` | Tools (DR 72) |
| `baitools` | `submit baitools` | AI tools, color CAPTCHA |
| `startup88` | `submit startup88` | Startup directory |

For stable mid-complexity forms, prefer a **YAML recipe** (`recipes/*.yaml`,
loaded by `src/sites/form-recipe.js`) over a JS adapter — no code needed.
Iframe-embedded forms (Paperform/Tally/Typeform/Airtable) go through
`src/sites/providers/`.

Deprecated adapters (`submitaitools`, `toolverto`, `600tools`, `dangai`) were
removed in v2.2; those sites now use the generic or recipe path.

## Generic Adapter (bb-browser)

Submit to **any** directory site without writing a custom adapter:

```bash
node src/cli.js submit https://example.com/submit --engine bb
```

Uses bb-browser's `snapshot` to auto-detect form fields (name, URL, email, description) and fill them from `config.yaml`. Requires `engine: bb`.

## Awesome-List Targets

| Key | Repo | Language |
|-----|------|----------|
| `chinese-independent-developer` | nichetools/chinese-independent-developer | Chinese |
| `awesome-privacy` | Lissy93/awesome-privacy | English |
| `awesome-wasm` | mbasso/awesome-wasm | English |
| `awesome-cloudflare` | zhuima/awesome-cloudflare | Chinese |
| `awesome-pwa` | nichetools/awesome-pwa | English |
| `awesome-indie` | mezod/awesome-indie | English |
| `awesome-oss-alternatives` | RunaCapital/awesome-oss-alternatives | English |
| `awesome-free-apps` | Axorax/awesome-free-apps | English |
| `awesome-no-login-web-apps` | nichetools/awesome-no-login-web-apps | English |
| `awesome-astro` | one-aalam/awesome-astro | English |

## Engine Selection

bb-browser is the only engine — `rebrowser-playwright` was removed in v2.2.
Adapters may still declare `engine: 'bb'` explicitly, but it is the default.
The CLI `--engine bb` flag and `config.yaml` `browser.engine: bb` are accepted
for compatibility; `--engine playwright` now exits with an error.

## Adding New Site Adapters

> The skeleton below is illustrative. For the current adapter interface, copy a
> live adapter such as `src/sites/futuretools.js`, or prefer a `recipes/*.yaml`
> recipe (no JS needed).

Create `src/sites/<sitename>.js`:

```javascript
import { withBrowser, delay } from '../browser.js';

export default {
  name: 'example.com',
  url: 'https://example.com/submit',
  auth: 'none',        // none | email | oauth
  captcha: 'none',     // none | color | recaptcha
  engine: 'bb',        // optional: force bb-browser for this adapter

  async submit(product, config) {
    return withBrowser(config, async ({ page }) => {
      await page.goto('https://example.com/submit', { waitUntil: 'networkidle' });
      // Fill form fields...
      // Submit...
      // Check confirmation...
      return { url: page.url(), confirmation: 'success message' };
    });
  },
};
```

Then use: `node src/cli.js submit <sitename>`

## bb-browser Auto-Update

Community adapters update automatically when `bb_browser.auto_update: true` in config.yaml (default). Force update:

```bash
node src/cli.js bb-update
```
