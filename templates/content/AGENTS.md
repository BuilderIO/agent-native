# Documents — Agent Guide

Documents is an agent-native editor for docs, comments, media blocks, sharing,
and Notion-connected content. The agent edits documents through actions and
application state shared with the UI.

Detailed document editing, Notion, storage, and UI rules live in
`.agents/skills/`.

Before building common workspace or agent UI, read `agent-native-toolkit` to
inventory existing public kits and installed package seams. Use
`customizing-agent-native` for the configure → compose → eject → propose seam
ladder.

## Core Rules

- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Use actions for documents, blocks, comments, media, sharing, navigation, and
  Notion integration. Do not mutate document rows directly unless a skill says to
  and access checks are preserved.
- Notion workspace access is per-user OAuth only. Never read `NOTION_API_KEY`
  from `process.env`, never save a user-entered Notion token through
  `/_agent-native/env-vars`, and require editor access for routes that pull or
  push Notion content.
- Treat Notion workflow actions as shortcuts, not capability limits. When the
  exact Notion endpoint/filter/pagination/API version matters, use
  `provider-api-catalog`, `provider-api-docs`, and `provider-api-request`
  against the real Notion API. The provider API resolves auth from the user's
  Notion OAuth connection, never from `NOTION_API_KEY`. For large scans, stage
  results with `stageAs` and analyze them with `query-staged-dataset`.
- Preserve user-authored content. Prefer targeted edits over wholesale rewrites
  unless requested.
- Screen context is auto-included as a `<current-screen>` block on every
  message — check it before acting instead of calling `view-screen` by
  default. Call `view-screen` explicitly only when that snapshot is truncated
  or doesn't yet reflect something that changed earlier in the same turn (for
  example, right after `create-document` or `navigate`).
- Keep public/exported content server-renderable where relevant.
- The editor uses live Yjs collaboration — raw SQL writes to `documents` won't
  appear in an open editor. Always use `edit-document` or `update-document`,
  and prefer `edit-document` for small changes (it sends only the changed
  text and syncs live via CRDT instead of regenerating the whole document).
- `create-document`, `update-document`, and `delete-document` already signal
  a UI refresh; only call `refresh-list` directly if you mutate documents
  another way and the UI doesn't update.

## Application State

- Before generation, follow the creative-context reuse ladder in
  `.agents/skills/creative-context/SKILL.md`: explicit request and current
  document first, then a pinned/current pack, then narrow library search.
  Respect `creative-context.contextMode: "off"` without silently restoring a
  pack.
- To submit a document to a governed Creative Context, use the Context tab or
  `manage-context-membership`; the app flushes live collaboration and captures
  one immutable Markdown version. Reuse only its opaque native clone reference.
  Use `operation="submit-latest"` with a Library membership id when its native
  update status reports `update-available`.

- `navigation` exposes document, selected block, comment, media, and Notion view
  context.
- `navigate` moves the UI to documents, comments, media, and settings surfaces.
- Use actions for full document content and comment context.

## Skills

- `creative-context` for cross-app source reuse, pinned packs, provenance, and
  context opt-out.

Read the relevant skill before deeper work:

- `document-editing` for structured document updates.
- `notion-integration` for connected Notion workflows.
- `storing-data`, `real-time-sync`, `security`, `actions`, `frontend-design`,
  and `shadcn-ui` for framework work.

## Navigation State

```json
{
  "view": "editor",
  "documentId": "abc123"
}
```

Views: `list` (document tree), `editor` (viewing/editing a document).

**Do NOT write to `navigation`** — it is overwritten by the UI. Use `navigate` to control the UI.

## Actions

In dev, call actions with `pnpm action <name>`; in production, call native
tools. Never use `curl`, raw HTTP requests, or `db-exec` with raw SQL for
document operations. `.env` is loaded automatically — never manually set
`DATABASE_URL` or other env vars.

`view-screen`, `navigate`, and `refresh-list` handle context and UI control.
`list-documents`, `search-documents`, `get-document`, `pull-document`,
`create-document`, `edit-document`, `update-document`, and `delete-document`
cover the core document workflow. Every action carries its own schema. Other
app-specific tools, including `remove-local-file-source`, are registered; use
`tool-search` instead of scanning a table here.

### Cross-App A2A / Slack Artifact Rule

Create or update the document through the normal action path (never a bespoke route) so the artifact stays visible and shareable. When a request arrives from Slack, Dispatch, or another app via A2A, the caller cannot see Content's local UI or navigation state: reply with the concrete document ID and URL/path only after the action succeeds. Use `/page/<id>` for private app documents (or `/p/<id>` only for documents you explicitly made public). Never say a document is ready without including the exact ID or URL/path returned by the action.

### Deeper Behavior (Read On Demand)

- `references/document-behavior.md` (`document-editing` skill) — description
  ownership, `pull-document`'s collab-flush handshake vs `get-document`,
  versions, image blocks, sharing/visibility (`/page/<id>` vs `/p/<id>`,
  discoverability, the read-only public chat).
- `references/local-file-mode.md` (`content` skill) — local folder sources,
  Builder Symbol/source-component preservation, local MDX components.
- `notion-integration` skill — connecting, sync, conflicts, the read-only
  database-source pilot.
- `document-editing` skill's Comments section — inline anchor-tracked
  threads, @mentions, resolve/reopen.

Documents are **private by default**; use `share-resource` /
`set-resource-visibility` (`resourceType document`) to change access.

## Common Tasks

| User request              | What to do                                                                        |
| ------------------------- | --------------------------------------------------------------------------------- |
| "What am I looking at?"   | Answer from `<current-screen>` (call `view-screen` only if truncated)             |
| "Create a page about X"   | `create-document --title "X" --content "# X\n\n..."`                              |
| "Fix a typo / small edit" | ID from `<current-screen>`, `edit-document --id ... --find "old" --replace "new"` |
| "Delete this page"        | ID from `<current-screen>`, `delete-document --id ...`                            |

IDs for edits always come from `<current-screen>` or a prior action result —
never guessed.

## Data Model

Documents live in the SQL `documents` table via Drizzle; the framework
injects the live column schema separately, so this section only covers
semantics the schema can't convey:

- `document_shares` holds per-user/per-org grants with a `viewer`, `editor`,
  or `admin` role.
- `document_versions`, `document_comments`, and `document_sync_links` all
  carry `owner_email` so a workspace can upgrade from local mode to a real
  account without losing history, comments, or Notion links.
- A database is a normal document (`content_databases` +
  `document_property_definitions`) whose rows are also documents, linked
  through `content_database_items`. Row pages are omitted from the ordinary
  sidebar tree — they're reached through the database view.

See `references/databases.md` in the `document-editing` skill for the full
database behavior reference: property types, Blocks fields, and every view
type (table, list, gallery, board, calendar, timeline, form).
