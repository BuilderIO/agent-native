# Design Systems

Design systems store brand identity tokens (colors, fonts, spacing, logos) that are applied to all slides in a deck.

## Data Model

Design systems are stored in the `design_systems` SQL table. Each has a `data` column with JSON tokens:

- `colors`: primary, secondary, accent, background, surface, text, textMuted
- `typography`: headingFont, bodyFont, headingWeight, bodyWeight, headingSizes
- `spacing`: slidePadding, elementGap
- `borders`: radius, accentWidth
- `slideDefaults`: background, labelStyle
- `logos`: array of { url, name, variant }
- `imageStyle`: referenceUrls, styleDescription
- `customCSS`: optional custom CSS

## Creating a Design System

1. User provides brand context (company name, website, assets, notes)
2. `analyze-brand-assets` gathers raw data (extracts CSS, fonts, colors from website)
3. Agent analyzes the data and calls `create-design-system` with extracted tokens
4. The design system is published and becomes available for deck creation

### Source: Figma `.fig` file

When the user uploads a raw Figma local copy (`.fig`), start Builder
design-system indexing with `import-file` instead of treating it like a
document:

```bash
pnpm action import-file --filePath "data/uploads/brand.fig" --format fig
```

The action requires Builder to be connected and returns Builder `projectId`,
`jobId`, `designSystemId`, and `builderUrl`. Builder is the source of truth for
the indexed brand kit, generated docs, and usage guidance.

Do not call `create-design-system` locally from `.fig` uploads. Do not call
`import-document` for `.fig` files; it only handles metadata and will miss the
Builder indexing flow.

### Source: connected code, GitHub, or `design.md`

For any other reusable source — connected code, a GitHub repo, local
code/design files, or an optional `design.md` — use Builder-backed DSI
indexing through `index-design-system-with-builder`. Pass readable `design.md`
content as `designMd`, and use the returned local design system id in the rest
of the Slides flow. Call `get-design-system` before generation so Builder docs
and tokens are hydrated when available.

Never create a duplicate local design system from raw Figma or code sources.
Builder owns the indexed brand kit; a second local copy drifts from it and
nothing records which one a deck was actually built from.

### Source: workspace default

A workspace admin can flag one design system as the workspace default, used by
members who have not set their own. `create-deck` resolves it server-side, so
call `get-workspace-defaults` only to name it or answer what the default is.
See the `create-deck` skill.

## Deleting a Design System

`delete-design-system` requires admin access or higher (owner or admin share
role) and removes the system, its shares, and the `designSystemId` link on
every linked deck the caller can edit — decks the caller can't edit keep a
dangling reference instead of being silently mutated, reported back as
`decksSkippedForAccess` (clear it later with `patch-deck`'s
`patch-deck-fields`, `designSystemId: null`). Those decks keep the tokens
already baked into their slides — deletion never rewrites deck content — so a
deck can look on-brand while no longer being linked to a system. If the
deleted system was the caller's default, another of their design systems is
promoted to default so future deck creation doesn't silently drop to "no
design system". Deletion does not remove an upstream Builder-indexed design
system.

## Applying to Slides

Before creating or extending a system, read the `creative-context` skill and
retrieve approved brand primitives separately from factual or layout examples.
Apply its reuse ladder exactly: native template/component/asset unchanged,
compose approved pieces, lightly adapt a real example, generate from narrow
references, then net-new only when the corpus is empty. A context pack is an
immutable generation snapshot, not a mutable design system.

When generating slides, replace default values with design system tokens:

- `#00E5FF` -> `colors.accent`
- `Poppins` -> `typography.headingFont` / `typography.bodyFont`
- `#000000` background -> `colors.background`
- `rgba(255,255,255,0.55)` -> `colors.textMuted`

## Tweaks

The Tweaks panel provides live CSS variable overrides:

- Accent color swatches
- Title case (lowercase/Title/UPPER)
- Background warmth

Changes persist to the design system and apply immediately via CSS custom properties.

Persist the chosen `contextPackId` and reuse labels with deck generation
provenance. Promote a retrieved pattern into the design system only after an
explicit user decision; do not silently turn search results into defaults.
