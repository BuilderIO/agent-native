# Slides — Agent Guide

Slides is an agent-native deck editor. The agent manages decks through actions
and shared SQL state.

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

## Actions

| Action | Purpose |
| --- | --- |
| `view-screen` | Read the active deck, slide, and selection when unclear |
| `navigate` | Move the UI to a deck, slide, or view |
| `create-deck` | Create a deck, optionally pre-populated with slides |
| `add-slide` | Append one slide to a deck |
| `update-slide` | Edit one slide's content or style |
| `patch-deck` | Delete, reorder, or patch multiple slides in one call |
| `delete-deck` | Delete a deck and its saved versions |
| `duplicate-deck` | Duplicate a deck, minting new slide ids |
| `get-deck` | Read a deck or one targeted slide's full HTML |
| `list-decks` | List decks with metadata, paged |
| `apply-design-system` | Link a design system's colors and typography to a deck |
| `export-pptx` | Export a deck as a PowerPoint file |
| `export-html` | Export a deck as a standalone HTML file |
| `export-google-slides` | Export a deck as a Google-Slides-importable PPTX |
| `generate-image-api` | Generate a slide image via the Assets app |

## Core Rules

- Keep large files/blobs in configured file storage, not SQL, settings, or
  resources; persist only URLs, ids, or handles.
- Never hardcode secrets or private/customer data; use vault/OAuth/runtime
  configuration and fake placeholders in examples.
- For external integrations, inspect the workspace/provider connection catalog first.
- Use actions (table above) for every deck/slide write; never write rows
  directly. Read the schema if a parameter is unclear.
- Use `view-screen` before editing when the active deck, selected slide, or
  current layout is unclear.
- Preserve deck structure and visual consistency. Prefer focused slide edits over
  regenerating whole decks unless requested.
- New-deck attachments are reference context. Import into a deck only after an
  explicit request or Import control; explicit imports follow `sourceImport`
  and preserve structure.
- A source import with `fidelity: partial` or `imagesSkipped` is not safe to
  restyle automatically; report the exact warning instead of silently
  replacing content.
- Preserve freeform objects and their `data-slide-object-id` values; keep
  generated flex/grid in normal flow and use styled HTML, not inline SVG (see
  `slide-editing`).
- Freeform dragging snaps within tolerance (Cmd/Ctrl bypasses); align via the
  contextual toolbar with 2+ selected objects, distribute with 3+.
- Follow linked design-system tokens.
- Import/export actions are shortcuts, not capability limits. For exact Google
  Drive API needs, use `provider-api-catalog`, `provider-api-docs`, and
  `provider-api-request`; auth comes from the user's Google Docs OAuth.
- `import-google-slides-reference` accepts a Picker `fileId` or
  `presentationUrl`; pasted URLs may need a one-time Google reconnect. Preserve
  imported PPTX timing metadata, including by-paragraph reveals.
- For per-click reveals, follow `slide-editing`'s click-to-reveal rules.
- For images, use `generate-image-api` with provenance; show results as
  `![alt](url)`.
- For focused selected-text edits follow the `update-slide` / `get-deck` /
  `patch-deck` contract in `slide-editing` (one literal replacement,
  `expectedMatches: 1`, `baseContentHash` from `view-screen`); the same rule
  reaches external callers through this app's `mcp.instructions`.
- For data requests, follow `analytics-data-for-decks`; delegate via Analytics
  over A2A, never write SQL or call providers directly.
- When the user names no reference deck or design system, call
  `get-workspace-defaults` first (see `create-deck`).
- Before generation, follow `creative-context` for source order, `contextMode`,
  and governed-context submission via `manage-context-membership`.
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
- Use actions for full deck/slide data instead of ambient context.

## Export Behavior

- PowerPoint and Google Slides export share two paths. Source-imported decks
  with no browser-authored freeform objects export via `export-pptx`, writing
  real vector shapes; every other deck exports from the rendered slide DOM,
  the only place editor-authored geometry is measurable. Do not substitute
  full-slide images unless the user asks for non-editable snapshots.
- Browser-authored means `data-slide-object-id` without
  `data-pptx-element-kind`, or `fmd-freeform-object`; `export-pptx` cannot
  measure those and fails loudly instead of silently re-exporting at lower
  fidelity.
- Google Slides export generates a PPTX for the user to import (File →
  Import); a native Google Slides file needs a separate Slides API
  batchUpdate path.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.
