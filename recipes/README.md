# Recipes

YAML form recipes consumed by `src/sites/form-recipe.js`. One file per site,
named `<siteKey>.yaml`. Recipes are TRUSTED — only commit recipes authored
in-repo, never load from untrusted sources.

## Top-level shape

```yaml
url: https://example.com/submit          # page to load
fields: [...]                            # text-like inputs/textareas
selects: [...]                           # <select> mapped via map.default
radios: [...]                            # radio groups mapped via map.default
checkboxes: [...]                        # legal-consent only (tos | privacy)
submit: "button[type=submit]"            # CSS selector of the submit button
```

## Field shapes

### `fields[]` — text inputs / textareas

```yaml
- key: name              # human label, used in error messages
  selector: 'input[name="tool_name"]'
  value: name            # one of the supported valueKeys (see below)
  optional: false        # default false; when true, missing values are skipped
```

### `selects[]` — `<select>` elements

```yaml
- key: category
  selector: 'select[name="category"]'
  valueFrom: categories  # source value key (resolved against product config)
  map:                   # source value → option label (textContent.trim() match)
    developer-tools: Generative Code
    image-generation: Generative Art
    default: Chat        # fallback when nothing matches
```

### `radios[]` — radio groups

```yaml
- key: pricing
  name: pricing_tier     # the input[name=...] attribute
  valueFrom: pricing
  map:
    free: free
    paid: paid
    default: free
```

### `checkboxes[]` — legal consent

```yaml
- type: tos              # ONLY 'tos' or 'privacy' — loader rejects anything else
  selector: 'input#tos-agree'
```

## Supported `value` / `valueFrom` keys

`name`, `url`, `utmUrl`, `email`, `description`, `longDescription`,
`categories` (array), `pricing`, `submitterName`, `twitter`, `github`, `logo`.

See `resolveRecipeValue()` in `src/sites/form-recipe.js` for the canonical list.

## `|nth=N` selector convention

Append `|nth=N` (zero-indexed) to any selector to target the Nth match instead
of the first. Used by WPCF7 forms that render multiple textareas with the same
`name`:

```yaml
- key: longDescription
  selector: 'textarea[name="your-message"]|nth=0'
  value: longDescription
- key: shortDescription
  selector: 'textarea[name="your-message"]|nth=1'
  value: description
```

The convention is implemented by `parseSelector`/`queryExpr` in
`src/sites/bb-recipe-page.js`.
