# Slides — Agent Guide

Slides is an agent-native deck editor. The agent creates, edits, imports,
exports, styles, shares, and navigates decks through actions and shared SQL
state.

Detailed deck, slide-editing, image, design-system, and export workflows live in
`.agents/skills/`.

Before building common workspace or agent UI, read `agent-native-toolkit` to
inventory existing public kits and installed package seams. Use
`customizing-agent-native` for the configure → compose → eject → propose seam
ladder.

## Core Rules

- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Use actions for deck lifecycle, slide edits, imports, exports, images, design
  systems, and sharing. Do not write deck/slide rows directly.
- In dev, call actions with `pnpm action <name>`; in production, use native
  tools. Read the action schema if a parameter is unclear.
- Use `view-screen` before editing when the active deck, selected slide, or
  current layout is unclear.
- Preserve deck structure and visual consistency. Prefer focused slide edits over
  regenerating whole decks unless requested.
- Preserve freeform objects and their `data-slide-object-id` values. They are
  absolutely positioned `.fmd-slide` children; keep generated flex/grid in
  normal flow and mint ids only for duplicates. Use styled HTML, not inline SVG.
- Follow linked design-system tokens and custom instructions.
- Build reusable design systems from Figma, code, GitHub, or `design.md` via
  Builder-backed DSI indexing, never a duplicate local copy. Read
  `design-systems` for the per-source actions.
- Import/export actions are shortcuts, not capability limits. For exact Google
  Drive API needs, use `provider-api-catalog`, `provider-api-docs`, and
  `provider-api-request`; auth comes from the user's Google Docs OAuth. Stage
  large scans with `stageAs` and analyze them via `query-staged-dataset`.
- Use image-generation and image-selection actions only when the deck genuinely
  needs imagery; keep citations/asset provenance when available.
- Use framework sharing actions for deck visibility and grants.
- For a known, read-only sibling-app operation, use `call-agent` with `action`
  and `input` (or `invokeAgentAction`) instead of starting the sibling agent's
  model loop. In Analytics, use `gong-native-insights` for provider-synthesized
  briefs and `gong-calls` for quotes, counts, transcripts, and coverage claims.
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
