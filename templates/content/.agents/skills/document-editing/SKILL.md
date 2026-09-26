---
name: document-editing
description: >-
  How to create, read, update, and delete documents. Covers the document scripts,
  markdown content model, parent-child hierarchy, and position ordering.
---

# Document Editing

Documents are stored in the SQL database via Drizzle ORM. Each document has a
title, stable description, markdown content, optional parent (for nesting), and
a position for ordering. The description explains why the page exists and what
belongs there; it is not a changing synopsis of the current body.

When operating Content through a connected MCP server, call these actions
yourself; route work through `ask_app` only when delegating to Content's own
agent is the explicit point of the request. Reaching tools you can call
directly through `ask_app` adds a second interpretation of the request and
hides real errors.

## Scripts

Always use the dedicated scripts for document operations. Never use raw `db-exec` SQL.

In dev, call actions with `pnpm action <name>`; in production, call native
tools. Never use `curl`, raw HTTP requests, or `db-exec` with raw SQL for
document operations. `.env` is loaded automatically — never manually set
`DATABASE_URL` or other env vars.

### list-documents

List document metadata in a tree structure. This intentionally does not return full document bodies; call `get-document` for the one document you need to read.

```bash
pnpm action list-documents
pnpm action list-documents --format json
```

### search-documents

Search documents by title and content. Results include snippets, not full document bodies; call `get-document` before editing or summarizing a specific result.

```bash
pnpm action search-documents --query "meeting notes"
pnpm action search-documents --query "project plan" --format json
```

### get-document

Get a single document by ID with full content.

```bash
pnpm action get-document --id abc123
pnpm action get-document --id abc123 --format json
```

### create-document

Create a new document.

```bash
pnpm action create-document --title "Meeting Notes" --content "# Meeting Notes\n\nAttendees: ..."
pnpm action create-document --title "Sub Page" --parentId parent123
pnpm action create-document --title "My Page" --icon "📝"
pnpm action create-document --title "Research" --description "Evidence and source notes that support the current project"
pnpm action create-document --title "Placeholder 1" --spaceName "Foobar"
```

When a user asks for a Page in an interactive Content conversation, creation is
not a complete handoff. After `create-document` succeeds, call `navigate` with
the returned document `id`, then call `view-screen` and compare its document ID
with the create result. Navigation is asynchronous: if `view-screen` still
reports the previous Page, repeat `navigate` and `view-screen` up to two more
times. Say the Page is open only after the IDs match. If they never match, say
the Page was created but navigation could not be verified, and provide the
stable Page link from the create result. Do not navigate for background, batch,
or API creation unless the caller explicitly asked to open the result.

When the user names a workspace ("in my Foobar workspace"), pass `spaceName`
(or a `spaceId` from `list-content-spaces`). A named workspace that does not
resolve is an error, never a silent fall back. With no `parentId`, `spaceId`,
or `spaceName` the page is created in the caller's Personal workspace, so read
the returned `spaceId` before telling the user where the page landed. The
Workspaces catalog is not a create target: its rows only list workspaces, and
`add-database-item` against it is rejected.

### edit-document

Surgically edit document content using search-and-replace. **Preferred over `update-document --content` for modifications** — sends only the changed text instead of regenerating the entire document.

```bash
# Single edit
pnpm action edit-document --id abc123 --find "old text" --replace "new text"

# Delete text
pnpm action edit-document --id abc123 --find "delete me" --replace ""

# Batch edits
pnpm action edit-document --id abc123 --edits '[{"find":"old","replace":"new"},{"find":"also old","replace":"also new"}]'
```

External MCP, WebMCP, tool, and A2A callers first read the document, then pass
its `baseRevision` and one stable `idempotencyKey`. When the returned body is
literally empty, pass non-whitespace `initializeContent` instead of `find` or `edits`.
Initialization rejects whitespace-only and all other nonempty bodies, preserves
the Markdown bytes exactly, and safely replays an identical retry.

### update-document

Update an existing document's metadata or browser-owned content. External
callers use the revisioned `edit-document` protocol for every body change.

```bash
pnpm action update-document --id abc123 --title "New Title"
pnpm action update-document --id abc123 --content "# Updated Content\n\nNew text here"
pnpm action update-document --id abc123 --title "New Title" --content "New content"
pnpm action update-document --id abc123 --description "Stable guidance for what belongs on this page"
```

### Suggested edits

When the user asks to **suggest**, **propose**, or **leave changes for review**,
do not call `edit-document` or `update-document`. Read the current Page with
`get-document`, then call `suggest-document-edit` with the Page's `id`, its
`baseRevision`, a fresh `idempotencyKey`, and the exact `find` text plus the
`replace` Markdown (omit `replace` to propose deleting the text). `find` must
match the page's current text exactly once. Content builds the tracked change
and anchor server-side; the page stays unchanged until a reviewer accepts.

Use `suggest-document-edit` for every suggested body edit. The generic
`create-resource-suggestion` action remains for advanced proposals that build
typed Page-body operations by hand: `resourceType: "document"`, adapter kind
`content.document-markdown`, the Page's `revision` (or exact `updatedAt`) as
`baseRevision`, a fresh `idempotencyKey`, and one operation carrying the
complete current and proposed Markdown in `before.markdown` and
`after.markdown`, the changed segment in `changedText`, and an `anchor` object.

Use `list-resource-suggestions` to inspect pending and historical proposals.
Only accept or reject when the user has asked for that decision and the caller
has editor authority; call `decide-resource-suggestion` with a fresh
idempotency key and the suggestion's `baseRevision` as `observedBase`. A stale
result means canonical Content was not overwritten. Suggested edits are
unavailable for local-file, source-owned, externally linked, collection-item, or
trashed Pages in this release.

```bash
pnpm action suggest-document-edit --id abc123 \
  --baseRevision 'body:0:sha256:…' --idempotencyKey '<uuid>' \
  --find 'Exact current sentence.' --replace 'Proposed replacement sentence.'
```

### delete-document

Move a document and all its children to Trash. IDs, bodies, hierarchy, and
collection membership remain intact so the subtree can be restored.

```bash
pnpm action delete-document --id abc123
```

Restore the root subtree, or permanently delete it only after it is in Trash:

```bash
pnpm action restore-document --id abc123
pnpm action plan-content-trash-purge --mode selection --documentIds '["abc123"]'
pnpm action permanently-delete-document --id abc123 --planId '<reviewed plan ID>' --scopeToken '<opaque plan token>'
```

Permanent deletion requires the exact `planId` and `scopeToken` returned by
`plan-content-trash-purge`. Inspect the plan's affected and blocked items before
executing it; if Trash changes after review, create and inspect a new plan.

## Comments

Comments are Notion/Google-Docs-style **inline comments**. Selecting text and commenting leaves the passage **highlighted inline** via a ProseMirror decoration overlay — nothing is written into the markdown body, so the document round-trips unchanged. Each thread stores the quoted text plus surrounding context (`anchorPrefix`/`anchorSuffix`) and an approximate `anchorStartOffset`, so the highlight follows the text as the document is edited, disambiguates repeated text, and degrades gracefully (the thread stays in the sidebar) when its text is deleted.

Resolving a thread clears its highlight and moves it to a collapsible **"Resolved (n)"** sidebar section, from which it can be **reopened**. Comments support **@mentions** of org members, stored as a `mentions` array of `{email, name}`.

```bash
# List threads (returns anchor fields + parsed mentions)
pnpm action list-comments --documentId abc123

# Plain comment on the document
pnpm action add-comment --documentId abc123 --content "Looks good"

# Inline-anchored comment with a mention
pnpm action add-comment --documentId abc123 --content "@Sam check this" \
  --quotedText "the second paragraph" --anchorPrefix "above " --anchorSuffix " here" \
  --anchorStartOffset 120 --mentions '[{"email":"sam@x.com","name":"Sam"}]'

# Reply to a thread
pnpm action add-comment --documentId abc123 --threadId t123 --content "Agreed"

# Resolve / reopen the whole thread
pnpm action update-comment --id c123 --resolved true
pnpm action update-comment --id c123 --resolved false
```

`--authorName` sets the comment's display name; it defaults to a name derived from the author's email.

A new comment emails the document owner, earlier authors in the thread, and anyone mentioned, unless they turned those emails off. The current user's own switch is `get-content-notification-prefs` and `update-content-notification-prefs --emailNotifications=false`, the same one Settings shows (Notifications, with the settings redesign on). Share invites always send.

### refresh-list

Trigger the UI to refresh the document list.

```bash
pnpm action refresh-list
```

Always run this after any document modification to update the sidebar.

`create-document`, `update-document`, and `delete-document` already signal a UI
refresh, so in practice only call `refresh-list` directly if you mutate
documents another way and the UI doesn't update.

## Document Schema

| Column        | Type    | Description                            |
| ------------- | ------- | -------------------------------------- |
| `id`          | text    | Primary key (12-char hex string)       |
| `parent_id`   | text    | Parent document ID (null for root)     |
| `title`       | text    | Document title (default: "Untitled")   |
| `description` | text    | Stable semantic guidance for the page  |
| `content`     | text    | Markdown content                       |
| `icon`        | text    | Emoji icon (optional)                  |
| `position`    | integer | Sort order within parent (0-based)     |
| `is_favorite` | integer | Whether document is favorited (0 or 1) |
| `created_at`  | text    | ISO timestamp                          |
| `updated_at`  | text    | ISO timestamp                          |

### Related Tables

Documents live in the SQL `documents` table via Drizzle; the framework injects
the live column schema separately, so this covers only semantics the schema
can't convey:

- `document_shares` holds per-user/per-org grants with a `viewer`, `editor`,
  or `admin` role.
- `document_versions`, `document_comments`, and `document_sync_links` all
  carry `owner_email` so a workspace can upgrade from local mode to a real
  account without losing history, comments, or Notion links.
- A collection is a normal document (`content_databases` +
  `document_property_definitions`) whose rows are also documents, linked
  through `content_database_items`. Row pages are omitted from the ordinary
  sidebar tree — they're reached through the collection view.

Documents are **private by default**; use `share-resource` /
`set-resource-visibility` (`resourceType document`) to change access.

## Content Format

Documents use **markdown** for content. The editor renders markdown in real time.

### Math

Content renders LaTeX with KaTeX while preserving the source in NFM. Use the
canonical Content delimiters when an agent creates or edits math:

```md
Inline math: The relationship is $`E = mc^2`$ in this example.

Block math:

$$
\int_0^1 x^2 dx = \frac{1}{3}
$$
```

- Inline math uses ``$`...`$``. Do not substitute ordinary `$...$`; dollar
  amounts in prose are intentionally not interpreted as equations.
- Block equations use `$$` on their own lines before and after the LaTeX.
- Keep the raw LaTeX intact when editing around an equation. Invalid or
  unsupported expressions remain visible as source so they can be repaired.
- Markdown exports preserve these delimiters. HTML and PDF-ready exports render
  the equation.

## Parent-Child Hierarchy

Documents form a tree via `parent_id`:

- Root documents have `parent_id = null`
- Child documents reference their parent's `id`
- Deleting a parent recursively deletes all children
- Position determines ordering within the same parent

To reorganize the tree, move each subtree with `move-document` using ids from
a prior action result. When the plan calls for a target page that does not
exist yet — a new section, a grouping page — create it first with
`create-document` and use the returned id as `parentId`.

Descriptions are owned; context is inherited. `get-document` and `view-screen`
return the focused page's own description plus a computed root-to-parent
`contextPath`. Use that path to understand where the page lives, but never copy
ancestor descriptions into the child. Collection, property, and option
descriptions narrow the guidance further when working with structured values.

## Screen Context And IDs

Screen context is auto-included as a `<current-screen>` block on every message —
check it before acting instead of calling `view-screen` by default. Call
`view-screen` explicitly only when that snapshot is truncated or doesn't yet
reflect something that changed earlier in the same turn (for example, right
after `create-document` or `navigate`).

IDs for edits always come from `<current-screen>` or a prior action result —
never guessed.

When a move or edit target does not exist yet, create it first and use the
returned id. A rejection saying `not found` means the id is absent: create the
missing page or list documents to find the right id. Never retry the same id
or invent a similar-looking one — fabricated ids cannot resolve, and repeated
failures stop the run.

| User request              | What to do                                                                        |
| ------------------------- | --------------------------------------------------------------------------------- |
| "What am I looking at?"   | Answer from `<current-screen>` (call `view-screen` only if truncated)             |
| "Create a page about X"   | `create-document`, then `navigate --documentId <returned id>` and verify with `view-screen` |
| "Fix a typo / small edit" | ID from `<current-screen>`, `edit-document --id ... --find "old" --replace "new"` |
| "Delete this page"        | ID from `<current-screen>`, `delete-document --id ...`                            |

## Common Tasks

| User says                    | What to do                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| "Create a page about X"      | `create-document`, then `navigate --documentId <returned id>` and verify with `view-screen` |
| "Describe what belongs here" | `update-document --id ... --description "..."`                                      |
| "Find my meeting notes"      | `search-documents --query "meeting notes"`                                          |
| "Fix a typo / edit a line"   | `view-screen` to get ID, then `edit-document --id ... --find "old" --replace "new"` |
| "Rewrite this document"      | `view-screen` to get ID, then `update-document --id ... --content ...`              |
| "Delete this page"           | `view-screen` to get ID, then `delete-document --id ...`                            |
| "Add a sub-page"             | `create-document --title "Sub" --parentId <parentId>`                               |
| "Show me the document tree"  | `list-documents`                                                                    |

Always run `refresh-list` after any create, update, or delete operation.

## Reference Files

- **`references/document-behavior.md`** — self-documenting descriptions,
  `pull-document`'s collab-flush handshake vs `get-document`, versions, image
  blocks, and the sharing/visibility model (`/page/<id>` vs `/p/<id>`,
  discoverability, the read-only public chat). Read it before touching
  descriptions, external ingest, or a document's visibility.
- **`references/databases.md`** — full behavioral reference for Content
  collections: property types, Blocks fields, and every view type (table,
  list, gallery, board, calendar, timeline, form). Read it before building or
  modifying collection views, properties, or forms.

Also read on demand, outside this skill:

- `references/local-file-mode.md` in the `content` skill — local folder
  sources, Builder Symbol/source-component preservation, local MDX components.
- The `notion-integration` skill — connecting, sync, conflicts, the read-only
  database-source pilot, and the raw Notion provider API path.
- The **Comments** section above — inline anchor-tracked threads, @mentions,
  resolve/reopen.
