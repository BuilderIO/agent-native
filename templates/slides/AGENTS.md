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
- For external integrations, inspect the workspace/provider connection catalog and reuse its scoped resolver.
- Use actions for deck lifecycle, slide edits, imports, exports, images, design
  systems, and sharing. Do not write deck/slide rows directly. Read the action
  schema if a parameter is unclear.
- Use `view-screen` before editing when the active deck, selected slide, or
  current layout is unclear.
- Preserve deck structure and visual consistency. Prefer focused slide edits over
  regenerating whole decks unless requested.
- Import uploaded PPTX/PDF into the target deck first. `sourceImport` is
  source-of-truth: preserve its slides, IDs, copy, notes, images, and objects;
  verify with `get-deck`. Do not restyle imports with `fidelity: partial` or
  `imagesSkipped`; report the exact warning.
- Preserve freeform objects and `data-slide-object-id` values. They are
  absolute `.fmd-slide` children; keep generated flex/grid in flow, mint IDs
  only for duplicates, and use styled HTML, not inline SVG.
- Freeform dragging snaps to guides; Cmd/Ctrl bypasses snapping. Align 2+
  compatible selected objects in the toolbar; distribute only 3+.
- Follow linked design-system tokens.
- For exact Google Drive API needs, use `provider-api-catalog`,
  `provider-api-docs`, and `provider-api-request` with the user's Google Docs
  OAuth. Stage large scans with `stageAs` and `query-staged-dataset`.
- `import-google-slides-reference` accepts Picker `fileId` or `presentationUrl`.
  Pasted URLs may need one Google reconnect. Preserve PPTX timing metadata.
- Per-click reveals use ordered 0-based targets and full-list patches; stale or
  missing targets disable reveals.
- For images, use `generate-image-api` with provenance; show results as
  `![alt](url)`.
- Ask sibling agents with natural-language `call-agent` messages by default.
  Invoke actions directly only for bounded reads with known schemas, never to
  work around slow or failed A2A.
- For data requests, read `analytics-data-for-decks` and delegate to Analytics
  over A2A; do not write SQL or call providers.
- Without a reference deck or design system, call `get-workspace-defaults`
  before generating a deck.
- Before generation, follow `creative-context`: explicit/current deck, then
  pinned/current pack, then narrow library search. Respect `contextMode: "off"`.
  Submit governed context through Context or `manage-context-membership`; reuse
  only its opaque clone reference.

## Action API

- Public actions use `/_agent-native/actions/<action-name>`, their declared
  HTTP method, and `Authorization: Bearer <token>`.
- Names, parameter schemas, and response fields are versioned: do not silently
  break them; record additions in the changelog.
- `appUrl` is the canonical human-open deck link. Keep legacy `url` and
  `deepLink` compatible; integrations map human links to `appUrl`.
- `export-pptx` and `export-html` return exactly `downloadUrl`, `filename`,
  and `expiresAt`. `export-google-slides` preserves its Google-import dialog
  metadata while passing through the same signed download fields. `expiresAt`
  is authoritative: fetch the binary promptly and do not forward the
  short-lived `downloadUrl`.
- The token-gated public binary route exists solely because action routes are
  authenticated JSON-only; it changes neither sharing nor permissions.

## Persistence Model

Deck data lives in SQL and all writes go through server-side actions. Read
`deck-management` before changing persistence or editor save paths.

## Application State

- `navigation` exposes the current deck, slide, selection, and editor view.
- `slides-selection` exposes selected elements and editing context. Use
  `view-screen` before visual/style edits.
- `navigate` moves the UI; actions return deck and slide data.

## Export Behavior

- Source-imported decks without browser-authored freeform objects use server
  `export-pptx` to preserve source geometry as vectors. Other decks export from
  rendered DOM; do not substitute full-slide images unless non-editable
  snapshots are requested.
- Browser-authored objects are `data-slide-object-id` without
  `data-pptx-element-kind`, or `fmd-freeform-object`. `export-pptx` fails
  loudly for them; never downgrade silently.
- Google Slides export generates a PPTX for manual import. Native Slides files
  require a separate Google Slides API `batchUpdate` path.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.

## Outbound Webhooks

- Slides owns `deck.created`, `deck.updated`, `deck.deleted`, `comment.added`, and `comment.updated` subscriptions and deliveries. Use the authenticated `/_agent-native/slides/webhooks` API; the create response is the only time its HMAC secret is returned. Read `docs/webhooks.md` before integrating a receiver.
