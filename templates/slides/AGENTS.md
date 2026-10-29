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

Shared framework conventions live in the matching skill under `.agents/skills/`.

## Framework Docs

For framework questions, use local docs: `pnpm action docs-search --query "<topic>"` or `pnpm action docs-search --slug "<slug>"`.

## Actions

| Action | Purpose |
| --- | --- |
| `view-screen` / `navigate` | Read deck/selection / move UI |
| `create-deck` / `add-slide` / `update-slide` / `patch-deck` | Create and edit slides |
| `delete-deck` / `duplicate-deck` / `get-deck` / `list-decks` | Manage and read decks |
| `list-deck-versions` / `restore-deck-version` | Read history / roll back |
| `list-deck-templates` / `get-deck-template` / `create-deck-from-template` | Browse/copy templates |
| `add-slide-comment` / `list-slide-comments` / `update-slide-comment` / `delete-slide-comment` / `toggle-slide-comment-reaction` | Manage comments |
| `read-composer-source` / `apply-design-system` | Read references / link design system |
| `generate-image-api` | Generate images locally; Assets is opt-in |
| `export-pptx` / `export-html` / `export-google-slides` | Export deck |

## Core Rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Use actions for deck/slide writes; keep large files in configured file storage, not SQL/settings/resources. Never hardcode secrets or private/customer data; use obvious placeholders.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.
- Scale work to the request. A blank slide, rename, reorder, or delete is one action call. A same-or-shorter text replacement, a selected-object or `selectedText` edit, or one style tweak is one `update-slide` call: no read-back, fit check, or contrast audit unless layout changes or text grows. Skip skill reads, `manage-progress`, and retitling for these, even after earlier generation turns.
- Author and edit decks with Slides actions; use Design by A2A only for a requested Design-owned input or a Design-only capability.
- Call `view-screen` only when the deck, slide, or selection is not already in the context block. "This", "this slide", or "here" with nothing selected means the current slide; ask only when there is none. Preserve requested structure; do not restyle imports marked partial or with `imagesSkipped` without reporting the warning.
- To undo your change, write back only the slides you changed from the newest `list-deck-versions` snapshot before it; `restore-deck-version` rolls back the whole deck.
- Slide HTML layout, card, no-SVG, and freeform-id rules: `slide-editing`.
- Import attachments only on request or via Import. `sourceImport` records provenance; structural edits clear it. Read preloaded new-deck attachments before deciding whether to import.
- Provider API actions are shortcuts, not limits. For exact Drive API needs use `provider-api-catalog` / `-docs` / `-request` with the user's Google Docs OAuth. Preserve imported PPTX timing metadata.
- For data requests, follow `analytics-data-for-decks` and delegate via Analytics/A2A; never query SQL or providers directly. Without a reference deck or design system, read `get-workspace-defaults` before generation; use `creative-context` for source order and context submission.

## Application State

- `navigation` exposes deck, slide, selection, and editor view; `navigate` opens decks, slides, imports, and exports.
- `slides-selection` describes selected elements, tool mode, transient selectors, text/image/video hints, and computed styles. Use actions for full data.
- `agent-selection` lists slides and elements picked with Select; a `Selected objects` context block names the target set, so edit only those.
- `slides-open-panel` records the open side panel (`layers` / `animations`) and `notesOpen` for the speaker notes panel; `view-screen` prints them as `openPanel` and `notesOpen`.
- Presenter speech navigation accepts exact localized next/previous slide phrases; keep transcripts transient and ignore narration.

## Export Behavior

Google Slides export produces a PPTX to import; a native Slides file needs the API `batchUpdate` path. Keep editable vector/DOM content, not full-slide images, unless requested. Read `deck-management` for export paths and failures.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read `customizing-agent-native` before adapting shared UI. Search with `rg --hidden --follow`.

## Actions for outside agents

| Action | Purpose |
| --- | --- |
| `clone-context-slide` | Copy a pinned native library slide into an editable deck, preserving provenance |
