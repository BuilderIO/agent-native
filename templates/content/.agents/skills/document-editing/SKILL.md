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

## Scripts

Always use the dedicated scripts for document operations. Never use raw `db-exec` SQL.

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
```

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

### update-document

Update an existing document. Use for **full rewrites or new content**, not for small changes (use `edit-document` instead).

```bash
pnpm action update-document --id abc123 --title "New Title"
pnpm action update-document --id abc123 --content "# Updated Content\n\nNew text here"
pnpm action update-document --id abc123 --title "New Title" --content "New content"
pnpm action update-document --id abc123 --description "Stable guidance for what belongs on this page"
```

### delete-document

Delete a document and all its children recursively.

```bash
pnpm action delete-document --id abc123
```

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

### refresh-list

Trigger the UI to refresh the document list.

```bash
pnpm action refresh-list
```

Always run this after any document modification to update the sidebar.

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

## Content Format

Documents use **markdown** for content. The editor renders markdown in real time.

## Parent-Child Hierarchy

Documents form a tree via `parent_id`:

- Root documents have `parent_id = null`
- Child documents reference their parent's `id`
- Deleting a parent recursively deletes all children
- Position determines ordering within the same parent

Descriptions are owned; context is inherited. `get-document` and `view-screen`
return the focused page's own description plus a computed root-to-parent
`contextPath`. Use that path to understand where the page lives, but never copy
ancestor descriptions into the child. Database, property, and option
descriptions narrow the guidance further when working with structured values.

## Common Tasks

| User says                    | What to do                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| "Create a page about X"      | `create-document --title "X" --content "# X\n\n..."`                                |
| "Describe what belongs here" | `update-document --id ... --description "..."`                                      |
| "Find my meeting notes"      | `search-documents --query "meeting notes"`                                          |
| "Fix a typo / edit a line"   | `view-screen` to get ID, then `edit-document --id ... --find "old" --replace "new"` |
| "Rewrite this document"      | `view-screen` to get ID, then `update-document --id ... --content ...`              |
| "Delete this page"           | `view-screen` to get ID, then `delete-document --id ...`                            |
| "Add a sub-page"             | `create-document --title "Sub" --parentId <parentId>`                               |
| "Show me the document tree"  | `list-documents`                                                                    |

Always run `refresh-list` after any create, update, or delete operation.
