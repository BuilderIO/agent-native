# Slides — Agent Guide

Slides is an agent-native deck editor. The agent creates, edits, imports,
exports, styles, shares, and navigates decks through actions and shared SQL
state.

Detailed deck, slide-editing, image, design-system, and export workflows live in
`.agents/skills/`.

Before building common workspace or agent UI, read `agent-native-toolkit` and
`customizing-agent-native` for the public kit and configure/eject seams.

## Core Rules

- Keep large files/blobs in configured file storage, not SQL, settings, or
  resources; persist only URLs, ids, or handles.
- Never hardcode secrets or private/customer data; use vault/OAuth/runtime
  configuration and fake placeholders in examples.
- Use actions for deck lifecycle, slide edits, imports, exports, images, design
  systems, and sharing. Do not write deck/slide rows directly.
- In dev, call actions with `pnpm action <name>`; in production, use native
  tools. Read the action schema if a parameter is unclear.
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
- Read `slide-editing` before creating slides; it covers fit, density, and overflow.
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
- For data requests, read `.agents/skills/analytics-data-for-decks/SKILL.md` and
  delegate via Analytics over A2A; do not write SQL or call providers directly.
- When the user names no reference deck or design system, call
  `get-workspace-defaults` first so a bare "make a deck about X" is still on
  brand.
- Before generation, follow `.agents/skills/creative-context/SKILL.md`: explicit
  request/current deck, then pinned/current pack, then narrow library search.
  Respect `contextMode: "off"`. Submit governed context through the Context tab
  or `manage-context-membership`; reuse only its opaque clone reference.

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

- Browser PowerPoint export uses the rendered slide DOM to generate native,
  editable PPTX text/shapes/images. Do not replace it with full-slide images
  unless the user explicitly asks for non-editable visual snapshots.
- The server-side `export-pptx` action cannot measure browser-rendered
  freeform geometry. It must fail clearly for positioned objects and direct the
  user to the editor's Export > PowerPoint path instead of silently reflowing
  them.
- Google Slides export is a PPTX import workflow: generate the same editable
  PPTX and have the user import it into Google Slides. Creating a native Google
  Slides file directly requires a separate Google Slides API batchUpdate path.

## Skills

Read the relevant skill before deeper work:

- `create-deck` for new decks, reference decks, workspace defaults, outlines.
- `slide-editing` for targeted slide changes.
- `deck-management` for organization, sharing, import/export, and metadata.
- `slide-images` and `image-generation-via-a2a` for image work.
- `design-systems`, `frontend-design`, `shadcn-ui`, and `actions` as needed.
- `creative-context` for cross-app source reuse, pinned packs, provenance, and
  context opt-out.
- `analytics-data-for-decks` for delegated data.
