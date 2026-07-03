# Slides — Agent Guide

Slides is an agent-native deck editor. The agent creates, edits, imports,
exports, styles, shares, and navigates decks through actions and shared SQL
state.

Detailed deck, slide-editing, image, design-system, and export workflows live in
`.agents/skills/`.

## Core Rules

- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Use actions for deck lifecycle, slide edits, imports, exports, images, design
  systems, and sharing. Do not write deck/slide rows directly.
- In dev, call actions with `pnpm action <name>`; in production, use native
  tools. Read the action schema if a parameter is unclear.
- Use `view-screen` before editing when the active deck, selected slide, or
  current layout is unclear.
- Preserve deck structure and visual consistency. Prefer focused slide edits over
  regenerating whole decks unless requested.
- Follow linked design-system tokens and custom instructions.
- For reusable design-system setup from Figma, connected code/GitHub, local
  code/design files, or optional `design.md`, use Builder-backed DSI indexing
  through `index-design-system-with-builder` or `import-file --format fig`.
  Pass readable `design.md` content as `designMd`, use the returned local design
  system id in Slides flows, and call `get-design-system` before generation to
  hydrate Builder docs/tokens when available. Do not create a duplicate local
  design system from raw Figma/code sources.
- Treat import/export actions as shortcuts, not capability limits. When the
  exact Google Drive endpoint, file metadata field, export format, pagination
  mode, or API version matters, use `provider-api-catalog`,
  `provider-api-docs`, and `provider-api-request` against the real provider
  API. Slides resolves Google Drive auth from the user's connected Google Docs
  OAuth account. For large scans, stage results with `stageAs` and analyze them
  with `query-staged-dataset`.
- Use image-generation and image-selection actions only when the deck genuinely
  needs imagery; keep citations/asset provenance when available.
- Use framework sharing actions for deck visibility and grants.

## Persistence Model

Decks are stored as a single JSON blob in the `decks.data` column. All writes
go through server-side read-modify-write actions that hold a per-deck lock,
so concurrent writers (human + agent, two humans) touching different slides
never overwrite each other's work.

**Agent actions** (`update-slide`, `add-slide`): continue to use their dedicated
granular actions — they share the same in-process deck lock.

**Browser editor** now calls `patch-deck` instead of a full PUT. If you are
extending the editor's save path, enqueue a granular op (`patch-slide`,
`delete-slide`, `reorder-slides`, `add-slide`, or `patch-deck-fields`) via
`enqueueDeckOp` in `DeckContext.tsx` — do NOT add a new full-deck PUT.

## Application State

- `navigation` exposes the current deck, slide, selection, and editor view.
- `slides-selection` exposes the active visual editing context: selected slide
  element(s), tool mode, transient selectors, text/image hints, and compact
  computed style data. Use `view-screen` before a visual/style edit so you can
  act on the same object the user clicked.
- `navigate` moves the UI to decks, slides, imports, and exports.
- Use app actions for full deck/slide data instead of relying on ambient context.

## Export Behavior

- Browser PowerPoint export uses the rendered slide DOM to generate native,
  editable PPTX text/shapes/images. Do not replace it with full-slide images
  unless the user explicitly asks for non-editable visual snapshots.
- Google Slides export is a PPTX import workflow: generate the same editable
  PPTX and have the user import it into Google Slides. Creating a native Google
  Slides file directly requires a separate Google Slides API batchUpdate path.

## Skills

Read the relevant skill before deeper work:

- `create-deck` for new decks and outline-to-slide flows.
- `slide-editing` for targeted slide changes.
- `deck-management` for organization, sharing, import/export, and metadata.
- `slide-images` and `image-generation-via-a2a` for image work.
- `design-systems`, `frontend-design`, `shadcn-ui`, and `actions` as needed.
