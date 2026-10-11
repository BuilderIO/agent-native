# Documents — Agent Guide

Documents is an agent-native editor for docs, comments, media blocks, collections, sharing, and Notion content. UI and agent share actions and application state.

## Skills

Search with `rg --hidden --follow`; read the exact linked guide before deeper work. App: `.agents/skills/content/SKILL.md` (Markdown/MDX, sources, collections, intake, artifact replies), `.agents/skills/document-editing/SKILL.md` (document/comment actions and data model), `.agents/skills/notion-integration/SKILL.md`, `.agents/skills/creative-context/SKILL.md`. Shared: `.agents/skills/actions/SKILL.md`, `.agents/skills/adding-a-feature/SKILL.md`, `.agents/skills/agent-native-docs/SKILL.md`, `.agents/skills/agent-native-toolkit/SKILL.md`, `.agents/skills/client-side-routing/SKILL.md`, `.agents/skills/content-product-development/SKILL.md`, `.agents/skills/context-awareness/SKILL.md`, `.agents/skills/customizing-agent-native/SKILL.md`, `.agents/skills/delegate-to-agent/SKILL.md`, `.agents/skills/external-agents/SKILL.md`, `.agents/skills/frontend-design/SKILL.md`, `.agents/skills/performance/SKILL.md`, `.agents/skills/portability/SKILL.md`, `.agents/skills/real-time-sync/SKILL.md`, `.agents/skills/reliable-mutations/SKILL.md`, `.agents/skills/secrets/SKILL.md`, `.agents/skills/security/SKILL.md`, `.agents/skills/self-modifying-code/SKILL.md`, `.agents/skills/shadcn-ui/SKILL.md`, `.agents/skills/sharing/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/turn-into-skill/SKILL.md`, `.agents/skills/workspace-conventions/SKILL.md`.

Use local docs only (no web research): `pnpm action docs-search --query "<topic>"` and `pnpm action docs-search --slug "<slug>"`.

## Core rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Use Content actions for operations; call them directly. `ask_app` delegates to Content's agent. Do not use raw HTTP or SQL for mutations unless a skill requires it and preserves access checks.
- Live Yjs body writes use actions. External agents use revisioned `edit-document` (with `initializeContent` only for an empty body); browser full rewrites use `update-document`. Preserve user-authored content; prefer targeted edits unless asked to rewrite.
- Mutations signal UI refresh. Use `refresh-list` only after an out-of-band mutation leaves the UI stale. Check auto-included `<current-screen>` first; refresh stale context with `view-screen`, and use only ids from context or action results.
- Documents are private by default; change access with sharing actions. Notion uses per-user OAuth and needs editor access for writes; see `notion-integration` for provider requests.
- Store large files outside SQL and persist references only. For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver. Never hardcode credentials, private data, or customer data.

## Application state

- `navigation` is UI-owned and overwritten; do not write it. Use `navigate` for `{ view: "list" | "editor", documentId }` and selected block/comment/media/Notion context. `list` is the document tree; `editor` is one open doc.
- `creative-context`: `contextMode`, `selectedContextId`, `currentPackId`, `pinnedPackId`; follow its reuse ladder and respect `contextMode: "off"`.
- `content-last-location-v1` is owned by the UI/landing resolver. `content-trash` stores filters, selected/preview Page ids, and purge operation id; it is context, not deletion authority.
- `content-import`: Import dialog progress, no file contents.
- Use actions for full document bodies and comment context.

## Key actions

Every action has a schema; use `tool-search` for comments, sharing, Collections, Notion, and other registered actions. Use `remove-local-file-source` to remove an imported local source without deleting its files.

| Action | Purpose |
| --- | --- |
| `view-screen` / `navigate` / `refresh-list` | Read context, move UI, refresh after out-of-band writes |
| `list-documents` / `search-documents` / `get-document` / `pull-document` | Browse metadata, search, read, or flush live state before reading |
| `get-blocks-field-word-count` | Count one exact collection field; omit `propertyId` for primary body |
| `create-document` / `edit-document` / `update-document` / `delete-document` | Create, revision-edit, update, or move a page and children to Trash |
| `import-content` / `undo-content-import` | Import Markdown as pages; undo trashes unedited imports |
| `list-content-trash` / `get-trashed-document` | Find/read authorized Trash without restoring |
| `plan-content-trash-purge` / `get-content-trash-purge-plan` / `execute-content-trash-purge` / `get-content-trash-operation` | Freeze, inspect, execute, and track permanent deletion |
| `list-content-database-blocks` / `mutate-content-database-block` | Read or mutate stable blocks in one exact collection row/property |
| `migrate-content-database-rows` | Validate, apply, verify; terminal phases use `manage-content-database-migration` |

Permanent deletion requires a frozen plan. Read `document-editing`; report blockers or conflicts instead of claiming Trash is empty. Sidebar order and active Views use the personal view `navigation` patch, never parentage. Recent means foreground visits; paging, active-path lookup, and visit recording are UI-owned.

Before building common workspace or agent UI, read `agent-native-toolkit`; for supported customization, read `customizing-agent-native`.
