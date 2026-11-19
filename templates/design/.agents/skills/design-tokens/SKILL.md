---
name: design-tokens
description: >-
  Read, import, preview, and edit a design's tokens. Use when working with CSS
  variables, DTCG token files, the Tokens panel, brand extraction, or Figma
  styles.
---

# Design Tokens

A design's tokens are the CSS custom properties in its HTML `:root` block, plus
the user's tweak selections and saved token types in `designs.data`
(`tweakSelections`, `tokenTypes`). There is no separate design-system record:
tokens live on the design.

## Actions

- `index-design-tokens { designId }` — friendly `{ name, cssVar, value, type, source }`
  list. Call it before authoring or restyling an existing design so new work
  reuses real values instead of inventing a palette. When files disagree on a
  variable it also returns `sources` and `sourceValues`.
- `import-design-tokens` — import pasted text or files: CSS variables,
  design.md-style notes, Tailwind/theme JSON, DTCG (W3C) JSON, hard-coded
  colors, spacing, radii, and fonts. A DTCG `$type` is saved as the token type;
  other tokens get a type guessed from the name. Limits live in
  `shared/design-token-import-limits.ts`.
- `preview-design-token-edit` — returns the `{ '--var': 'value' }` payload the
  client pushes into the iframe. No writes.
- `apply-design-token-edit` — persists edits through the same tweak bridge as
  `apply-tweaks`. Pass `type` on new tokens to save it in `tokenTypes`.

## Brand extraction and Figma

- `import-from-url`, `import-github`, and `analyze-brand-assets` pull colors,
  fonts, and logos from a site, repo, or uploaded assets. Feed the result into
  `import-design-tokens`.
- `get-figma-styles` reads published Figma styles for the same purpose.

## Rules

- Edit tokens through the actions above, not by rewriting `:root` by hand, so
  the Tokens panel and reload keep the same values.
- Keep the same `--var` name across screens of one design.
- Fold the user's stated image style into every `generate-asset` prompt.
