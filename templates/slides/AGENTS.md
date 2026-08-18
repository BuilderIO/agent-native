# Slides — Agent Guide

Slides is an agent-native deck editor. The agent creates, edits, imports,
exports, styles, shares, and navigates decks through actions and shared SQL
state.

## Skills

Read the relevant skill before deeper work:

- `create-deck` for new decks, reference decks, workspace defaults, outlines.
- `slide-editing` for targeted slide changes; covers fit, density, and overflow.
- `deck-management` for organization, sharing, import/export, and metadata.
- `slide-images` and `image-generation-via-a2a` for image work.
- `design-systems` for per-source design-system actions.
- `creative-context` for cross-app source reuse, pinned packs, provenance, and
  context opt-out.
- `analytics-data-for-decks` for delegated data requests.

## Core Rules

- Keep large files/blobs in configured file storage, not SQL, settings, or
  resources; persist only URLs, ids, or handles.
- Never hardcode secrets or private/customer data; use vault/OAuth/runtime
  configuration and fake placeholders in examples.
- Use actions for deck lifecycle, slide edits, imports, exports, images, design
  systems, and sharing. Do not write deck/slide rows directly. Read the action
  schema if a parameter is unclear.
- Use `view-screen` before editing when the active deck, selected slide, or
  current layout is unclear.
- Preserve deck structure and visual consistency. Prefer focused slide edits over
  regenerating whole decks unless requested.
- When improving an uploaded PPTX or PDF, import it into the target deck first.
  Treat `sourceImport` as the source-of-truth contract: preserve slide count,
  order, IDs, copy, notes, images, and positioned objects; verify with
  `get-deck`.
- A source import with `fidelity: partial` or `imagesSkipped` is not safe to
  restyle automatically. Report the exact warning rather than silently
  replacing missing content.
- Preserve freeform objects and their `data-slide-object-id` values. They are
  absolutely positioned `.fmd-slide` children; keep generated flex/grid in
  normal flow and mint ids only for duplicates. Use styled HTML, not inline SVG.
- Freeform dragging shows transient peer/canvas alignment guides and snaps
  within tolerance; hold Cmd/Ctrl to bypass snapping. With 2+ compatible
  selected objects, use the contextual toolbar to align to selection bounds;
  distribute only when 3+ objects are selected.
- Follow linked design-system tokens; read `design-systems` for per-source actions.
- Import/export actions are shortcuts, not capability limits. For exact Google
  Drive API needs, use `provider-api-catalog`, `provider-api-docs`, and
  `provider-api-request`; auth comes from the user's Google Docs OAuth. Stage
  large scans with `stageAs` and analyze them via `query-staged-dataset`.
- `import-google-slides-reference` accepts a Picker `fileId` or `presentationUrl`;
  pasted URLs may need a one-time Google reconnect for Drive export. Preserve
  imported PPTX timing metadata, including by-paragraph reveals, on slide
  records.
- For per-click reveals, use ordered 0-based animation targets and patch the
  complete animation list with content; stale or missing targets disable
  reveals.
- For images, use `generate-image-api` with provenance; show results as
  `![alt](url)`.
- Ask a sibling app's agent with a natural-language `call-agent` message by
  default. Let that specialist use its own instructions, skills, sources, and
  tools. Direct action invocation is only for an exact bounded read with a
  fully known schema; never use it as a workaround for slow or failed A2A.
- For data requests, read `analytics-data-for-decks` and delegate via Analytics
  over A2A; do not write SQL or call providers directly.
- When the user names no reference deck or design system, call
  `get-workspace-defaults` first so a bare "make a deck about X" is still on
  brand.
- Before generation, follow `creative-context`: explicit request/current deck,
  then pinned/current pack, then narrow library search. Respect
  `contextMode: "off"`. Submit governed context through the Context tab or
  `manage-context-membership`; reuse only its opaque clone reference.

## Persistence Model

Deck data lives in SQL and all writes go through server-side actions. Read
`deck-management` before changing persistence or editor save paths.

## Application State

- `navigation` exposes the current deck, slide, selection, and editor view.
- `slides-selection` exposes the active visual editing context: selected slide
  element(s), tool mode, transient selectors, text/image hints, and compact
  computed style data. Use `view-screen` before a visual/style edit so you can
  act on the same object the user clicked.
- `navigate` moves the UI to decks, slides, imports, and exports.
- Use app actions for full deck/slide data instead of relying on ambient context.

## Export Behavior

- PowerPoint and Google Slides export share two paths. Source-imported decks
  with no browser-authored freeform objects export through the server
  `export-pptx`, which writes their source geometry as real vector shapes; the
  browser exporter can only rasterize it. Every other deck exports from the
  rendered slide DOM, the one place editor-authored geometry is measurable. Do
  not substitute full-slide images unless the user asks for non-editable
  snapshots.
- Browser-authored means `data-slide-object-id` without
  `data-pptx-element-kind`, or `fmd-freeform-object`. `export-pptx` cannot
  measure those and fails loudly; show that failure instead of quietly
  re-exporting at lower fidelity.
- Google Slides export is a PPTX import workflow: generate that PPTX and have
  the user import it into Google Slides. Creating a native Google Slides file
  directly requires a separate Google Slides API batchUpdate path.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.
