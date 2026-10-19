# Slides — Agent Guide

Slides is an agent-native deck editor. The agent manages decks through actions
and shared SQL state.

## Skills

Read relevant guides before deeper work:
- `.agents/skills/create-deck/SKILL.md` — for new/reference decks and outlines.
- `.agents/skills/slide-editing/SKILL.md` — for targeted edits and fit.
- `.agents/skills/deck-management/SKILL.md` — for organize/share/import/export.
- `.agents/skills/slide-images/SKILL.md` — for image work.
- `.agents/skills/image-generation-via-a2a/SKILL.md` — for requested Assets brand-library images.
- `.agents/skills/design-systems/SKILL.md` — for deck design systems.
- `.agents/skills/slide-design/SKILL.md` — for visual-craft requests.
- `.agents/skills/apply-slide-comments/SKILL.md` — for applying/resolving comments.
- `.agents/skills/creative-context/SKILL.md` — for source reuse and context.
- `.agents/skills/analytics-data-for-decks/SKILL.md` — for delegated data requests.

For shared framework conventions, read the matching skill under `.agents/skills/`;
workspace instructions list the shared guides.

## Framework Docs

For framework questions, use local docs: `pnpm action docs-search --query "<topic>"` or `pnpm action docs-search --slug "<slug>"`. For slide requests to look up or add public facts, load `web-search` and `web-request` with `tool-search`.

## Actions

| Action | Purpose |
| --- | --- |
| `view-screen` / `navigate` | Read deck/selection / move UI |
| `create-deck` / `add-slide` / `update-slide` / `patch-deck` | Create and edit slides |
| `delete-deck` / `duplicate-deck` / `get-deck` / `list-decks` | Manage and read decks |
| `list-deck-templates` / `get-deck-template` / `create-deck-from-template` | Browse/copy templates |
| `add-slide-comment` / `list-slide-comments` / `update-slide-comment` / `delete-slide-comment` / `toggle-slide-comment-reaction` | Manage comments |
| `read-composer-source` / `apply-design-system` | Read references / link design system |
| `generate-home-suggestions` / `generate-image-api` | Suggest prompts / create image via Assets |
| `export-pptx` / `export-html` / `export-google-slides` | Export deck |

## Core Rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Use actions for deck/slide writes; keep large files in configured file storage, not SQL/settings/resources. Never hardcode secrets or private/customer data; use obvious placeholders.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.
- Scale work to the request: a blank slide, rename, reorder, or delete is one action call. Skip skill reads, `manage-progress`, retitling, and fit/contrast audits for it, even when an earlier turn in the thread carried generation instructions.
- Slides authors decks through Slides actions. Use Design by A2A only for a user-requested Design-owned input or a capability only Design provides; keep deck creation and edits in Slides.
- Use `view-screen` when the active deck/slide/layout is unclear, and on every turn that says "this"/"here"/"selected". Preserve requested structure; do not restyle imports marked partial or with `imagesSkipped` without reporting the warning.
- Slide HTML layout, card, no-SVG, and freeform-id rules: `slide-editing`.
- Import attachments only on request or via Import. `sourceImport` records provenance; structural edits clear it. Read preloaded new-deck attachments before deciding whether to import.
- Provider API actions are shortcuts, not limits. For exact Drive API needs use `provider-api-catalog` / `-docs` / `-request` with the user's Google Docs OAuth. Preserve imported PPTX timing metadata.
- For data requests, follow `analytics-data-for-decks` and delegate via Analytics/A2A; never query SQL or providers directly. Without a reference deck or design system, read `get-workspace-defaults` before generation; use `creative-context` for source order and context submission.

## Persistence Model

Deck data lives in SQL; all writes go through server-side actions. Read `deck-management` before changing persistence or save paths.

## Application State

- `navigation` exposes deck, slide, selection, and editor view; `navigate` opens decks, slides, imports, and exports.
- `slides-selection` describes selected elements, tool mode, transient selectors, text/image/video hints, and computed styles. Read `view-screen` before visual/style edits; use actions for full data.
- `slides-open-panel` records the open side panel (`layers` / `animations`); `view-screen` prints it as `openPanel`.
- Presenter speech navigation accepts exact localized next/previous slide phrases; keep transcripts transient and ignore narration.

## Export Behavior

Google Slides export produces a PPTX for the user to import; a native Slides file requires a separate API `batchUpdate` path. Preserve editable vector/DOM content; do not substitute full-slide images unless requested. Read `deck-management` for export path selection and failure details.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read `customizing-agent-native` before adapting shared UI.

Search with `rg --hidden --follow`; read the exact linked guide before deeper work.
