---
name: document-editing
description: >-
  How to create, read, update, and delete documents. Covers the document scripts,
  markdown content model, parent-child hierarchy, and position ordering.
---

# Document Editing

Documents are stored in the SQL database via Drizzle ORM. Each document has a title, markdown content, optional parent (for nesting), and a position for ordering.

## Scripts

Always use the dedicated scripts for document operations. Never use raw `db-exec` SQL.

### list-documents

List all documents in a tree structure.

```bash
pnpm action list-documents
pnpm action list-documents --format json
```

### search-documents

Search documents by title and content.

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
```

### delete-document

Delete a document and all its children recursively.

```bash
pnpm action delete-document --id abc123
```

### refresh-list

Trigger the UI to refresh the document list.

```bash
pnpm action refresh-list
```

Always run this after any document modification to update the sidebar.

## Document Schema

| Column       | Type    | Description                             |
| ------------ | ------- | --------------------------------------- |
| `id`         | text    | Primary key (12-char hex string)        |
| `parent_id`  | text    | Parent document ID (null for root)      |
| `title`      | text    | Document title (default: "Untitled")    |
| `content`    | text    | Markdown content                        |
| `icon`       | text    | Emoji icon (optional)                   |
| `position`   | integer | Sort order within parent (0-based)      |
| `is_favorite`| integer | Whether document is favorited (0 or 1)  |
| `created_at` | text    | ISO timestamp                           |
| `updated_at` | text    | ISO timestamp                           |

## Content Format

Documents use **markdown** for content. The editor renders markdown in real time.

## Parent-Child Hierarchy

Documents form a tree via `parent_id`:
- Root documents have `parent_id = null`
- Child documents reference their parent's `id`
- Deleting a parent recursively deletes all children
- Position determines ordering within the same parent

## Common Tasks

| User says                     | What to do                                                       |
| ----------------------------- | ---------------------------------------------------------------- |
| "Create a page about X"       | `create-document --title "X" --content "# X\n\n..."`           |
| "Find my meeting notes"       | `search-documents --query "meeting notes"`                      |
| "Fix a typo / edit a line"    | `view-screen` to get ID, then `edit-document --id ... --find "old" --replace "new"` |
| "Rewrite this document"       | `view-screen` to get ID, then `update-document --id ... --content ...` |
| "Delete this page"            | `view-screen` to get ID, then `delete-document --id ...`       |
| "Add a sub-page"              | `create-document --title "Sub" --parentId <parentId>`           |
| "Show me the document tree"   | `list-documents`                                                |

Always run `refresh-list` after any create, update, or delete operation.
