---
name: design-systems
description: >-
  Apply, inspect, or create slide design systems. Use before generating or
  restyling slides when colors, typography, spacing, imagery, or slide defaults
  need to be resolved.
---

# Design Systems

Design systems store brand identity tokens (colors, fonts, spacing, logos) that are applied to all slides in a deck.

## Precedence

The active linked design system is the source of truth for slide tokens,
typography, spacing, imagery, and custom CSS. Resolve it before authoring HTML.
An explicit user accessibility or brand constraint can change the direction;
do not silently detach or replace the system. Then apply the following layers:

1. Explicit current-turn content and brand constraints.
2. The explicitly selected, personal, or workspace design system.
3. Approved Creative Context assets and a reference deck's composition patterns.
4. Generic create-deck and slide-editing examples as fallback only.
5. Impeccable-inspired guidance as a bounded review lens for hierarchy,
   subtraction, contrast, density, and polish, never as a replacement palette
   or component grammar.

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

## Native creation and refinement

`get-builder-dsi-access` checks the signed-in caller's personal Builder account.
An organization connection alone does not qualify a teammate. Resolve missing
or expired access through the existing Builder connection flow; keep the draft.
Account eligibility is not a generation or publication receipt.

Use `start-design-system-authoring` with the name, intent, complete source batch
and origin draft. Reuse its request ID only for identical retries. This reserves
the native workspace and conversation, not generated output. Follow-ups stay in
the returned conversation; Builder runs behind it without a product handoff.

Read `get-design-system-workspace` before generating. New workspaces use
`runtime: "builder"`; their files and publication live in Builder, with only
scoped references and artifact metadata in Agent-Native.

| Action | Purpose |
| --- | --- |
| `run-design-system-agent` | Send a direction to the same persistent Builder DSI session, preparing the entire reference batch on first start |
| `get-design-system-workspace` | Read actual provider progress, source outcomes, file inventory and canonical session binding |
| `get-design-system-artifact` | Read a real Builder file at its recorded artifact revision |
| `read-design-system-source` | Inspect scoped source evidence and extraction limitations |
| `update-design-system-workspace` | Append references, explicitly exclude/restore sources or change selection with workspace CAS |
| `get-design-system` | Resolve confirmed published context for Design or Slides generation |

For Start fresh, ask for direction if none was supplied, then pass that direction
to `run-design-system-agent`. References starts with the complete saved batch.
Use a stable `requestId` for one turn. Refinements pass the selected `targetId`
when relevant and `expectedRevision: workspace.builder.revision`. This remote
revision is a string, distinct from the numeric workspace/target revisions.

The returned session is a submission receipt until its actual progress says
otherwise. Read the existing workspace after interruption; never start another
system to recover an unknown outcome. Keep failed or unsupported sources visible
and let the user correct or exclude them. Source upload acceptance does not prove
interpretation. Read generated file bodies before describing their contents.

Builder workspaces reject local `write-design-system-artifact` output and
client-authored generation statuses. Existing native-only workspaces retain
their legacy writer; do not silently migrate or replace their saved artifacts.
Builder's actual file inventory determines the canvas, not a fixed sample kit.

The user chooses **Use** after reviewing the output. That action publishes the
exact Builder revision and verifies its receipt before attaching it to the
originating composer. A completed turn does not mean published. Generation reads
reject unpublished or changed context. No default or sharing policy changes
implicitly.

Cross-app `consumedRevision` is the numeric `workspace.contentRevision` returned
as `reference.revision` by `get-design-system`; keep its `ownerApp`. Artifact
reads retain the selected artifact's numeric revision and verify the underlying
Builder file hash. Stale content is an explicit failure, not a switch to latest.

### Supported references

- Website: a public HTTP(S) URL read through the scoped SSRF-safe extractor.
  Builder receives bounded evidence, not a complete website capture.
- Brand files: owner/org-bound uploads, up to 20 MiB each and 100 MiB per batch.
  PDF, supported images and text retain original bytes. JSON is sent as original
  plain-text bytes. DOCX/PPTX use extracted text with explicit loss of layout,
  images and typography; unsupported extraction remains a visible failure.
- Figma: a file/design URL, optionally a frame. The connected-account reader
  supplies bounded paints, typography and geometry, not Variables or complete
  file fidelity. Preserve its access and size errors. Raw `.fig` and old
  unverified Builder upload tokens are not native collector inputs.

Adding sources stages them on the same workspace. Keep prior sources and manual
decisions; never silently ignore a changed batch or create a replacement project.
Explicit exclusion retains the evidence and history. Corrected sources append a
new entry and exclude the old one only at the user's direction.

### Existing provider-backed systems

Legacy indexing/editor/sync actions remain available for existing systems or
explicit advanced requests. They do not replace the persistent native authoring
session. Builder's editor is optional; its backend is the authoring runtime.
GitHub/npm are not creation choices in this MVP.

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
`decksSkippedForAccess` (clear it later with `patch-deck`'s
`patch-deck-fields`, `designSystemId: null`). Those decks keep the tokens
already baked into their slides — deletion never rewrites deck content — so a
deck can look on-brand while no longer being linked to a system. If the
deleted system was the caller's default, another of their design systems is
promoted to default so future deck creation doesn't silently drop to "no
design system". Deletion does not remove an upstream Builder-indexed design
system.

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
`get-design-system` once for the authored foundations, components, usage rules,
and legacy context before the first slide, retaining the attached reference's
`ownerApp` and `consumedRevision`. Pass that exact
`designSystemRef: { id, ownerApp, consumedRevision }` to `create-deck`; for a
newly read selection, map the returned `reference.systemId`,
`reference.ownerApp`, and `reference.revision` respectively. A local legacy ID
resolves the actual owner and revision; repeating the same ID preserves an
existing pin. Omitting the reference preserves it when updating an existing
deck; `null` explicitly opts out. Stale or inaccessible references fail before
writes: re-read the selected context before retrying, rather than dropping its
pin. Use `get-deck`'s `deckStyle` and `representativeSlideId` to match an existing
deck (the actions skill documents the field).

Before calling a deck ready, render the changed slides and perform one bounded
review for system consistency, hierarchy, contrast, overflow, missing assets,
placeholder remnants, and editable-object preservation. Fix the batch once and
recheck; do not claim brand fidelity from successful action responses alone.

## Tweaks

The Tweaks panel provides live CSS variable overrides:

- Accent color swatches
- Title case (lowercase/Title/UPPER)
- Background warmth

Changes persist to the design system and apply immediately via CSS custom properties.

Persist the chosen `contextPackId` and reuse labels with deck generation
provenance. Promote a retrieved pattern into the design system only after an
explicit user decision; do not silently turn search results into defaults.
