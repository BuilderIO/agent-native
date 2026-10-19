# Slides 2 — Agent Guide

Create and edit slide decks through Agent-Native chat and the visual editor, backed by shared SQL data and actions.

## Skills

- `.agents/skills/create-deck/SKILL.md` — generate or continue a deck.
- `.agents/skills/slide-editing/SKILL.md` — edit generated or legacy slides.
- `.agents/skills/design-systems/SKILL.md` — choose or change deck themes.
- `.agents/skills/creative-context/SKILL.md` — reuse brand and slide examples.
- `.agents/skills/deck-management/SKILL.md` — organize, import, share, or export decks.
- `.agents/skills/slide-images/SKILL.md` — find or generate imagery.
- `.agents/skills/slide-design/SKILL.md` — handle visual-craft requests.
- `.agents/skills/apply-slide-comments/SKILL.md` — apply slide comments.
- `.agents/skills/analytics-data-for-decks/SKILL.md` — research data for a deck.
- `.agents/skills/actions/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/context-awareness/SKILL.md` — actions, persistence, and current-screen behavior.

## Core Rules

- AI generation and synthesis happen in agent chat. The UI calls deterministic actions and never calls an LLM.
- Deck state lives in SQL; use actions for reads and writes. Store binary media in configured blob storage.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver before app-local credentials.
- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Before building common workspace or agent UI, read `agent-native-toolkit`; for supported customization, read `customizing-agent-native`.
- `sourceTsx` is canonical for generated slides; `content` is derived preview HTML. Use HTML only for legacy or imported slides.
- Read and save source-backed edits with `get-slide-source` and revision-checked `update-slide-source`. Do not write generated markup through `update-slide` or `patch-deck` content fields.
- The server validates slide source. Render previews only in the opaque-origin sandbox; use uploaded `asset://` handles for media.
- Keep `navigation` and `slides-selection` current. Call `view-screen` if the active deck, slide, or selection is unclear.
- Match the work to the request and use its focused action. Confirm writes with a read-back before claiming success.

## Actions

| Action | Purpose |
| --- | --- |
| `view-screen` | Read current navigation, deck, slide, and selection. |
| `control-presenter` | Queue live slide navigation, blackout, or deck switch. |
| `navigate` | Open the deck list, templates, a deck, or theme view. |
| `list-decks` | List accessible decks. |
| `list-deck-templates` | Browse available templates. |
| `get-deck-template` | Read a template. |
| `get-deck` | Read deck slides, style, and design context. |
| `list-assets` | Browse slide and deck assets. |
| `get-design-system`, `list-design-systems` | Read one or browse available design systems. |
| `apply-design-system` | Link a design system to a deck. |
| `get-workspace-defaults`, `get-deck-reference-context` | Read workspace defaults and reusable deck context. |
| `create-deck`, `create-deck-from-template` | Create a deck directly or from a template. |
| `add-slide` | Add a slide to a saved deck. |
| `update-slide` | Edit legacy slide content or structure. |
| `get-slide-source`, `update-slide-source` | Read source and save revision-checked source edits. |
| `transform-slide-objects` | Insert, duplicate, delete, or transform source-backed objects. |
| `control-slide-editor` | Save, undo, or redo the active editor tab. |
| `patch-deck` | Apply supported deck structure or style edits. |
| `search-svgl-logos`, `import-svgl-logo` | Find a logo and import it as a slide asset. |
| `export-pptx` | Export a deck as PowerPoint. |

## Application State

- `navigation` identifies the current view, deck, and slide. Home also records `homeTab` (`recent` or `templates`), `deckSearch`, and `deckFilter` (`all`, `created-by-me`, or `shared`); the templates route uses `search`; the themes route can include `themeId`.
- `slides-selection` records selected source locations and their displayed properties.
- `slides-open-panel` identifies the open editor panel.
- `slide-editor-status` exposes bounded, tab-scoped draft and undo/redo metadata; `slide-editor-command` is a one-shot editor command, not authorization.
- `presenter-control-queue` stores bounded, short-lived presentation commands, including deck switches, until the console relays them to the live projection.

Read `create-deck` and `slide-editing` for source syntax. Search skills with `rg --hidden --follow` and local docs with `pnpm action docs-search --query "<topic>"` or `pnpm action docs-search --slug "<slug>"`.
