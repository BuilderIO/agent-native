# Slides — Agent Guide

Slides is an agent-native deck editor. The agent manages decks through actions
and shared SQL state.

## Skills

Read relevant guides before deeper work:
- `.agents/skills/create-deck/SKILL.md` — for new/reference decks and outlines.
- `.agents/skills/slide-editing/SKILL.md` — for targeted edits and fit.
- `.agents/skills/deck-management/SKILL.md` — for organize/share/import/export.
- `.agents/skills/slide-images/SKILL.md` — for image work.
- `.agents/skills/image-generation-via-a2a/SKILL.md` — for A2A image generation.
- `.agents/skills/design-systems/SKILL.md` — for deck design systems.
- `.agents/skills/slide-design/SKILL.md` — for visual-craft requests.
- `.agents/skills/creative-context/SKILL.md` — for source reuse and context.
- `.agents/skills/analytics-data-for-decks/SKILL.md` — for delegated data requests.

`.agents/skills/actions/SKILL.md`, `.agents/skills/adding-a-feature/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/security/SKILL.md`,
`.agents/skills/secrets/SKILL.md`, `.agents/skills/sharing/SKILL.md`, `.agents/skills/frontend-design/SKILL.md`, `.agents/skills/shadcn-ui/SKILL.md`,
`.agents/skills/real-time-sync/SKILL.md`, `.agents/skills/context-awareness/SKILL.md`, `.agents/skills/delegate-to-agent/SKILL.md`, `.agents/skills/agent-native-docs/SKILL.md`,
`.agents/skills/agent-native-toolkit/SKILL.md`, `.agents/skills/customizing-agent-native/SKILL.md`, `.agents/skills/client-side-routing/SKILL.md`, `.agents/skills/reliable-mutations/SKILL.md`,
`.agents/skills/performance/SKILL.md`, `.agents/skills/external-agents/SKILL.md`, `.agents/skills/portability/SKILL.md`, `.agents/skills/self-modifying-code/SKILL.md`,
`.agents/skills/turn-into-skill/SKILL.md`, `.agents/skills/workspace-conventions/SKILL.md`.

## Framework Docs

Use local framework docs, not web research: `pnpm action docs-search --query "<topic>"` searches; `pnpm action docs-search --slug "<slug>"` reads a page.

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
- Use `view-screen` when the active deck/slide/layout is unclear. Preserve requested structure; do not restyle imports marked partial or with `imagesSkipped` without reporting the warning.
- Preserve freeform objects and their ids. Keep generated flex/grid in normal flow and use styled HTML, not inline SVG; see `slide-editing`.
- Import attachments only on request or via Import. `sourceImport` records provenance; structural edits clear it. Read preloaded new-deck attachments before deciding whether to import.
- Provider API actions are shortcuts, not limits. For exact Drive API needs use `provider-api-catalog` / `-docs` / `-request` with the user's Google Docs OAuth. Preserve imported PPTX timing metadata.
- For data requests, follow `analytics-data-for-decks` and delegate via Analytics/A2A; never query SQL or providers directly. Without a reference deck or design system, read `get-workspace-defaults` before generation; use `creative-context` for source order and context submission.

## Persistence Model

Deck data lives in SQL; all writes go through server-side actions. Read `deck-management` before changing persistence or save paths.

## Application State

- `navigation` exposes deck, slide, selection, and editor view; `navigate` opens decks, slides, imports, and exports.
- `slides-selection` describes selected elements, tool mode, transient selectors, text/image hints, and computed styles. Read `view-screen` before visual/style edits; use actions for full data.

## Export Behavior

Google Slides export produces a PPTX for the user to import; a native Slides file requires a separate API `batchUpdate` path. Preserve editable vector/DOM content; do not substitute full-slide images unless requested. Read `deck-management` for export path selection and failure details.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read `customizing-agent-native` before adapting shared UI.

Search with `rg --hidden --follow`; read the exact linked guide before deeper work.
