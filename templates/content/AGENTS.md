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
- `creative-context` — cross-app source reuse, pinned packs, provenance, and
  context opt-out.

## Core Rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Use actions for Content operations. Never use raw HTTP or SQL for document
  mutations unless a skill explicitly requires it and preserves access checks.
- Call these actions directly; `ask_app` only delegates to Content's agent.
- The live Yjs editor requires actions for body writes. External agents use
  revisioned `edit-document`, with `initializeContent` only for an empty body.
  Browser full rewrites use `update-document`.
- Preserve user-authored content. Prefer targeted edits over wholesale rewrites
  unless requested.
- Document mutations signal UI refresh; use `refresh-list` only after an
  out-of-band mutation leaves the UI stale.
- Check the auto-included `<current-screen>` before acting. Read stale context
  with `view-screen`; use only IDs from context or action results.
- Documents are private by default. Change access through sharing actions.
- Notion uses per-user OAuth and requires editor access to write. See
  `notion-integration` for exact provider API requests.
- Store large files and blobs outside SQL; persist only URLs, IDs, or handles.
- Never hardcode credentials or private/customer data. Use scoped connections,
  OAuth, runtime configuration, and obvious placeholders.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.

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
- `content-trash` — bounded Trash filters, up to 100 selected Page IDs, the
  preview Page ID, and the current purge operation ID. Treat selection and
  filters as UI context, not deletion authority; plan the exact scope before
  permanent deletion.
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
| `resolve-content-landing` | Restore the caller's last authorized page |
| `edit-document` | Revisioned find/replace, or initialize an empty body |
| `update-document` | Metadata or browser-owned full rewrite |
| `delete-document` | Move a page and its children to Trash |
| `list-content-trash` | Search authorized root or nested Trash metadata |
| `get-trashed-document` | Read one authorized trashed Page body without restoring it |
| `plan-content-trash-purge` | Freeze exact selected/matching Pages and their trashed descendants, or a whole scope |
| `get-content-trash-purge-plan` | Read every authorized item and effect in a frozen purge plan |
| `execute-content-trash-purge` | Confirm a reviewed purge and start its persisted operation |
| `get-content-trash-operation` | Read persisted purge progress and bounded outcomes |
| `list-content-database-blocks` | List stable blocks and revisions in one exact collection row/property |
| `mutate-content-database-block` | Insert, update, upsert, delete, or reorder one supported stable block |
| `migrate-content-database-rows` | Validate/apply/verify; terminal phases use `manage-content-database-migration` |

Every action carries its schema. Use `tool-search` for comments, sharing,
Collections, Notion, local sources such as `remove-local-file-source`, and the
rest of the registered surface.

For permanent deletion, always plan before executing and report blockers or
conflicts rather than claiming Trash is empty. Scope mode means all manageable
Trash in the chosen space scope and intentionally ignores text, kind, actor,
and location filters. A selected or matching Page includes only itself and its
currently trashed descendants, never its Trash root or siblings. New or changed
Trash after planning is not silently added.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`;
read `customizing-agent-native` before adapting shared UI.
