---
name: design-systems
description: >-
  Apply, inspect, or create slide design systems. Use before generating or
  restyling slides when colors, typography, spacing, imagery, or slide defaults
  need to be resolved.
---

# Design Systems

Design systems store brand identity tokens (colors, fonts, spacing, logos) that are applied to all slides in a deck.

## Built-in slide themes

Browse bundled authoring references with `list-slide-themes` and read the
selected guide with `get-slide-theme`. Themes are distinct from SQL design
systems: adapt the guide to the Slides 2 runtime, then record the selected
theme ID in each generated slide's static `meta.theme`. Open the gallery with
`navigate` using `view: "themes"`; set `themeId` to open one theme directly.

## Precedence

The active linked design system is the source of truth for slide tokens,
typography, spacing, imagery, and custom CSS. Resolve it before authoring HTML.
An explicit user accessibility or brand constraint can change the direction;
do not silently detach or replace the system. Then apply the following layers:

1. Explicit current-turn content and brand constraints.
2. The explicitly selected, personal, or workspace design system.
3. Approved Creative Context assets and a reference deck's composition patterns.
4. Generic create-deck and slide-editing examples as fallback only.
5. The `slide-design` skill as visual craft on top of these layers:
   hierarchy, scale contrast, composition, subtraction, and polish, never as a
   replacement palette, font, or component grammar.

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
- `visibility`: organization-scoped systems default to `org`; local systems default to `private`

## Creating a Design System

1. User provides brand context (company name, website, assets, notes)
2. `analyze-brand-assets` renders a website in a real browser and gathers the
   computed visual system (colors, fonts, spacing, radii, shadows, components,
   CSS variables, logos, and design.md-style guidance)
3. Agent analyzes the data and calls `create-design-system` with extracted tokens
4. The design system is published and becomes available for deck creation

When an organization is active, newly created systems are shared with that
organization by default. Builder-indexed local proxy systems follow the same
visibility rule.

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

For any other reusable source - connected code, a GitHub repo, local
code/design files, or an optional `design.md` - use Builder-backed DSI
indexing through `index-design-system-with-builder`. Pass GitHub sources as one
`githubSources` array; each source may pin a branch/tag/commit and include
repository-relative files or folders. Pass readable `design.md` content as
`designMd`, and use the returned local design system id in the rest of the
Slides flow. Call `get-design-system` before generation so Builder docs and
tokens are hydrated when available. For a saved GitHub-backed system, call
`sync-design-system-with-builder --id <localDesignSystemId>` to replay its
persisted source scope after upstream changes.

Never create a duplicate local design system from raw Figma or code sources.
Builder owns the indexed brand kit; a second local copy drifts from it and
nothing records which one a deck was actually built from.

That rule is about duplicates, not about failures. When
`index-design-system-with-builder` fails there is nothing to duplicate, so
never end a setup request with nothing created: build the design system with
`create-design-system` from the same sources and say plainly that Builder
indexing was unavailable and why. An indexing error the user cannot see, with
no design system to select afterwards, reads as the request being dropped.

### Source: workspace default

A workspace admin can flag one design system as the workspace default, used by
members who have not set their own. `create-deck` resolves it server-side, so
call `get-workspace-defaults` only to name it or answer what the default is.
See the `create-deck` skill.

The personal default is separate from the workspace default. Use
`set-default-design-system` with `isDefault: false` to clear a personal star;
setting another system clears the previous star in the same organization.

## Deleting a Design System

`delete-design-system` requires admin access or higher (owner or admin share
role) and removes the system, its shares, and the `designSystemId` link on
every linked deck the caller can edit — decks the caller can't edit keep a
dangling reference instead of being silently mutated, reported back as
`decksSkippedForAccess`. Once you have editor access, clear a skipped link with
`patch-deck`'s `patch-deck-fields` operation and `designSystemId: null`. The
agent schema allows null to unlink a system; use `apply-design-system` to link a
system. Those decks keep the tokens already baked into their slides — deletion
never rewrites deck content — so a deck can look on-brand while no longer being
linked to a system. If the deleted system was the caller's default, another of
their design systems is promoted to default so future deck creation doesn't
silently drop to "no design system". Deletion does not remove an upstream
Builder-indexed design system.

The Design Systems page renders every row `list-design-systems` returns —
including rows written before `data` validation existed, whose `colors` or
`typography` sections may be empty or missing. `parseDesignSystemListData` in
`app/pages/DesignSystems.tsx` fills gaps with the same defaults
`useDeckDesignSystem` applies rather than hiding the row, so a legacy or
malformed design system always keeps a visible card and a working Delete
control.

## Applying to Slides

Before creating or extending a system, read the `creative-context` skill and
retrieve approved brand primitives separately from factual or layout examples.
Apply its reuse ladder exactly: native template/component/asset unchanged,
compose approved pieces, lightly adapt a real example, generate from narrow
references, then net-new only when the corpus is empty. A context pack is an
immutable generation snapshot, not a mutable design system.

For an existing unlinked deck, resolve the intended system, call
`apply-design-system` with its `deckId` and `designSystemId`, then read the
linked system with `get-design-system` before restyling.

When generating slides, read the hydrated system and write a compact deck-level
visual direction before choosing a layout. Keep the system's tokens fixed while
varying slide composition, hierarchy, and narrative to fit the source. Treat
the resulting theme contract as a consistency boundary: the background family,
text/surface/accent roles, type pairing, spacing scale, radius, and image
treatment stay fixed across the deck. Put the contract in semantic
`--deck-*` custom properties on every wrapper, backed by the renderer's
`--ds-*` variables when a system is linked. Do not hard-code a sample palette,
font, logo treatment, or component language into individual slides. If no
system or measured reference exists, choose a subject-appropriate direction
once and repeat it; vary structure, not theme.

Every deck read returns `designSystem` as a bounded summary; call
`get-design-system` once for the full context before the first slide, and use
`get-deck`'s `deckStyle` and `representativeSlideId` to match an existing deck
(the actions skill documents the field).

Before calling a deck ready, render the changed slides and perform one bounded
review for system consistency, hierarchy, contrast, overflow, missing assets,
placeholder remnants, and editable-object preservation. Fix the batch once and
recheck; do not claim brand fidelity from successful action responses alone.

## Bundled authoring themes

When a user asks to browse or use a bundled visual direction, call
`list-slide-themes` and then `get-slide-theme` for the selected ID. The result
is an authoring guide, separate from Home's deck templates and SQL design
systems. Apply its direction in Agent chat using the supported source contract;
the guide is visual reference, not executable demo code. Keep static source
type sizes at or below 320px. Do not copy its remote font URLs, DOM insertion,
browser globals, or effect-driven animation; use system font stacks, static
scoped CSS, and the supported Worker hooks.

Bundled theme guide values and Slides 2 SQL deck tokens have different shapes:

| Guide `design` value | SQL deck token |
| --- | --- |
| `palette.bg` / `palette.text` / `palette.accent` | `background` / `text` / `accent` |
| `fonts.display` / `fonts.body` | `displayFont` / `bodyFont`; imported families also require their registered asset ID |
| Pixel-valued `typeScale.hero` / `typeScale.body` | `heroScale` / `bodyScale` multipliers from 0.5 to 2; choose a scale rather than passing pixel values |
| `radius` | `radius` only when it is between 0 and 48 |

Do not pass a theme guide's `design` object directly to SQL token actions. Once a
deck exists, read and persist the supported whole-deck token values with
`get-deck-design-tokens` and `update-deck-design-tokens`, using the current
`updatedAt` for compare-and-swap. Keep theme details that do not fit the token
schema in slide source. For a reusable workspace brand, create or link a SQL
design system instead.

## Tweaks

The Tweaks panel provides live CSS variable overrides:

- Accent color swatches
- Title case (lowercase/Title/UPPER)
- Background warmth

Changes persist to the design system and apply immediately via CSS custom properties.

## Slides 2 deck theme

Slides 2 stores a separate visual theme on each deck. Read it with
`get-deck-design-tokens({ deckId })`; save a complete token set with
`update-deck-design-tokens({ deckId, expectedUpdatedAt, tokens })`. Re-read the
current timestamp and retry after a revision conflict. The editor applies the
saved tokens to every slide in the isolated preview.

Tokens are `background`, `text`, and `accent` hex colors; `displayFont` and
`bodyFont` from the built-in system fonts or an imported family paired with
`displayFontAssetId` or `bodyFontAssetId`; `heroScale` and `bodyScale` from 0.5
to 2; and `radius` from 0 to 48. Search with `search-google-fonts`, import a
family variant with `import-google-font`, and use the returned `family` and
`assetId`. Import requires configured file storage. In slide source, map them to `--deck-bg`, `--deck-ink`,
`--deck-accent`, `--deck-heading-font`, `--deck-body-font`,
`--deck-hero-scale`, `--deck-body-scale`, and `--deck-radius`, respectively.
Use these variables in inline style objects so changing the deck theme updates
all slides together.

Persist the chosen `contextPackId` and reuse labels with deck generation
provenance. Promote a retrieved pattern into the design system only after an
explicit user decision; do not silently turn search results into defaults.
