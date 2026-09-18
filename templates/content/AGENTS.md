# Documents — Agent Guide

Documents is an agent-native editor for docs, comments, media blocks, databases,
sharing, and Notion-connected content; the agent and the UI share the same
actions and application state.

## Skills

Read the relevant skill before deeper work:

- `content` — Markdown/MDX authoring, local folder sources, databases, intake
  forms, and Slack/A2A artifact replies.
- `document-editing` — document/comment actions, screen context, and databases.
- `notion-integration` — connected Notion workflows and the raw Notion provider
  API path.
- `creative-context` — cross-app reuse, pinned packs, and context opt-out.

## Core Rules

- Use actions for Content operations. Do not mutate document rows directly.
  Never use raw HTTP or SQL for document operations.
- The editor uses live Yjs collaboration. Use `edit-document` for targeted
  changes and `update-document` for full rewrites.
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
| `view-screen` | Re-read stale screen context |
| `navigate` | Move the UI to Content destinations |
| `list-documents` | List document metadata without bodies |
| `search-documents` | Search titles and content |
| `get-document` | Read one full document |
| `pull-document` | Flush collaboration state, then read |
| `create-document` | Create a page |
| `resolve-content-landing` | Resolve the caller's landing page |
| `get-content-recent` | List personal recent destinations with current access, optionally scoped to a Content space's Files membership |
| `edit-document` | Make a targeted text change |
| `update-document` | Replace title, content, or description |
| `delete-document` | Move a page tree to Trash |
| `list-content-database-blocks` | List blocks and revisions in a database field |
| `mutate-content-database-block` | Mutate one stable database block |
| `migrate-content-database-rows` | Run a bounded row migration |

Every action carries its own schema, and the rest of the app-specific surface
(comments, sharing, databases, Notion, local file sources such as
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
