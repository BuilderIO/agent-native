# Documents — Agent Guide

Documents is an agent-native editor for docs, comments, media blocks, databases,
sharing, and Notion-connected content; the agent and the UI share the same
actions and application state.

## Skills

Read the relevant skill before deeper work:

- `content` — Markdown/MDX authoring, local folder sources, databases, intake
  forms, and Slack/A2A artifact replies.
- `document-editing` — document and comment actions, screen context and IDs,
  common tasks, the data model, and the databases reference.
- `notion-integration` — connected Notion workflows and the raw Notion provider
  API path.
- `creative-context` — cross-app source reuse, pinned packs, provenance, and
  context opt-out.

## Core Rules

- Use actions for documents, blocks, comments, media, sharing, navigation, and
  Notion integration. Do not mutate document rows directly unless a skill says to
  and access checks are preserved. Never use `curl`, raw HTTP requests, or
  `db-exec` with raw SQL for document operations.
- The editor uses live Yjs collaboration — raw SQL writes to `documents` won't
  appear in an open editor. Always use `edit-document` or `update-document`,
  and prefer `edit-document` for small changes (it sends only the changed
  text and syncs live via CRDT instead of regenerating the whole document).
- Preserve user-authored content. Prefer targeted edits over wholesale rewrites
  unless requested.
- `create-document`, `update-document`, and `delete-document` already signal
  a UI refresh; only call `refresh-list` directly if you mutate documents
  another way and the UI doesn't update.
- Screen context is auto-included as a `<current-screen>` block on every
  message — check it before acting instead of calling `view-screen` by default.
  IDs for edits always come from `<current-screen>` or a prior action result,
  never guessed.
- Documents are **private by default**; use `share-resource` /
  `set-resource-visibility` (`resourceType document`) to change access. Keep
  public/exported content server-renderable where relevant.
- Notion workspace access is per-user OAuth only: never read `NOTION_API_KEY`
  from `process.env`, never save a user-entered token, and require editor access
  to pull or push. Notion actions are shortcuts, not capability limits — see
  `notion-integration` for the `provider-api-*` path when an exact endpoint,
  filter, pagination mode, or API version matters.
- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.

## Application State

- `navigation` — `{ "view": "list" | "editor", "documentId": "abc123" }`, plus
  selected block, comment, media, and Notion view context. `list` is the
  document tree; `editor` is one open document. **Do NOT write to
  `navigation`** — it is overwritten by the UI. Use `navigate` to control the UI.
- `creative-context` — `contextMode`, `selectedContextId`, `currentPackId`,
  `pinnedPackId`. Follow the `creative-context` reuse ladder before generating,
  and respect `contextMode: "off"` without silently restoring a pack.
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
| `create-document` | Create a page, optionally under a parent |
| `edit-document` | Find/replace edit — preferred for small changes |
| `update-document` | Full rewrite of title, content, or description |
| `delete-document` | Move a page and its children to Trash |
| `migrate-content-database-rows` | Validate, atomically apply, verify, roll back, or finalize one bounded whole-database row migration |

Every action carries its own schema, and the rest of the app-specific surface
(comments, sharing, databases, Notion, local file sources such as
`remove-local-file-source`) is registered too — use `tool-search` instead of
scanning a table here.

Sidebar ordering has two deliberately different meanings. Reordering Pinned or
workspace roots moves the exact database membership identified by both
`databaseId` and `itemId`; it never reparents or moves the referenced document.
Files sidebar Custom order is a per-user database-view preference written with
`update-content-database-personal-view`, so it must not change shared Files
membership positions. Ordinary unconstrained database row reordering remains a
shared database mutation through `move-database-item`.
