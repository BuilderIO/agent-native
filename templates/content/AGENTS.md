# Documents — Agent Guide

Documents is an agent-native editor for docs, comments, media blocks, collections,
sharing, and Notion-connected content; the agent and the UI share the same
actions and application state.

## Skills

Read the relevant skill before deeper work:

- `content` — Markdown/MDX authoring, local folder sources, collections, intake
  forms, and Slack/A2A artifact replies.
- `document-editing` — document and comment actions, screen context and IDs,
  suggestions, common tasks, the data model, and the collections reference.
- `notion-integration` — connected Notion workflows and the raw Notion provider
  API path.
- `creative-context` — cross-app reuse, pinned packs, and context opt-out.

## Core Rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Use actions for documents, blocks, comments, media, sharing, navigation, and
  Notion integration. Do not mutate document rows directly unless a skill says to
  and access checks are preserved. Never use `curl`, raw HTTP requests, or
  `db-exec` with raw SQL for document operations.
- Call these actions directly; `ask_app` only delegates to Content's agent.
- The live Yjs editor requires actions for body writes. External agents use
  revisioned `edit-document`, with `initializeContent` only for an empty body.
  Browser full rewrites use `update-document`.
- Preserve user-authored content. Prefer targeted edits over wholesale rewrites
  unless requested.
- Screen context is auto-included as a `<current-screen>` block on every
  message — check it before acting instead of calling `view-screen` by default.
  IDs for edits always come from `<current-screen>` or a prior action result,
  never guessed.
- Documents are private by default. Use sharing actions to change access, and
  keep public/exported content server-renderable where relevant.
- Notion workspace access is per-user OAuth only: never read `NOTION_API_KEY`
  from `process.env`, never save a user-entered token, and require editor access
  to pull or push. Notion actions are shortcuts, not capability limits — see
  `notion-integration` for the `provider-api-*` path when an exact endpoint,
  filter, pagination mode, or API version matters.
- Store large files outside SQL; persist URLs, ids, or handles.
- Never hardcode secrets or private/customer data. Use secrets, OAuth, runtime
  configuration, and obvious placeholders.
- For external integrations, inspect the workspace/provider connection catalog
  first; reuse its scoped resolver.

## Application State

- `navigation` — `{ "view": "list" | "editor", "documentId": "abc123" }`, plus
  selected block, comment, media, and Notion view context. `list` is the
  document tree; `editor` is one open document. **Do NOT write to
  `navigation`** — it is overwritten by the UI. Use `navigate` to control the UI.
- `creative-context` — `contextMode`, `selectedContextId`, `currentPackId`,
  `pinnedPackId`. Follow the `creative-context` reuse ladder before generating,
  and respect `contextMode: "off"` without silently restoring a pack.
- `content-last-location-v1` — the last successfully loaded Page. The UI and
  landing resolver own this state; do not write it from agent workflows.
- Use actions for full document content and comment context.

## Actions

| Action | Purpose |
| --- | --- |
| `view-screen` | Re-read the current screen when `<current-screen>` is stale |
| `navigate` | Move the UI to a document, comments, media, or settings |
| `refresh-list` | Repaint the sidebar after an out-of-band mutation |
| `list-documents` | Document metadata tree, without bodies |
| `search-documents` | Title and content search with snippets |
| `get-document` | One document with full content |
| `pull-document` | Flush live collab state, then read (external edits) |
| `get-blocks-field-word-count` | Count one exact Blocks field; omit `propertyId` for the primary Content body |
| `create-document` | Create a page, optionally under a parent |
| `resolve-content-landing` | Restore the caller's last authorized page in a requested Content space |
| `get-content-recent` | List personal recent destinations with current access, optionally scoped to a Content space's Files membership |
| `edit-document` | Revisioned find/replace, or initialize an empty body |
| `update-document` | Metadata or browser-owned full rewrite |
| `delete-document` | Move a page and its children to Trash |
| `list-content-database-blocks` | List stable blocks and revisions in one exact collection row/property |
| `mutate-content-database-block` | Insert, update, upsert, delete, or reorder one supported stable block |
| `migrate-content-database-rows` | Validate/apply/verify; terminal phases use `manage-content-database-migration` |

Every action carries its own schema, and the rest of the app-specific surface
(comments, sharing, collections, Notion, local file sources such as
`remove-local-file-source`) is registered too — use `tool-search` instead of
scanning a table here.

Sidebar order and active Views use `update-content-database-personal-view`'s
`navigation` patch, never parentage or membership. Shared row order uses
`move-database-item`. Recent means foreground visits, with Database visits
coalesced to the latest View. Sidebar paging, active-path lookup, and visit
recording are UI-owned; agents use the listed reads and `navigate`.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.
