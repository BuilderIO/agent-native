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
pnpm script list-documents
pnpm script list-documents --format json
```

### search-documents

Search documents by title and content.

```bash
pnpm script search-documents --query "meeting notes"
pnpm script search-documents --query "project plan" --format json
```

### get-document

Get a single document by ID with full content.

```bash
pnpm script get-document --id abc123
pnpm script get-document --id abc123 --format json
```

### create-document

Create a new document.

```bash
pnpm script create-document --title "Meeting Notes" --content "# Meeting Notes\n\nAttendees: ..."
pnpm script create-document --title "Sub Page" --parentId parent123
pnpm script create-document --title "My Page" --icon "📝"
```

### update-document

Update an existing document.

```bash
pnpm script update-document --id abc123 --title "New Title"
pnpm script update-document --id abc123 --content "# Updated Content\n\nNew text here"
pnpm script update-document --id abc123 --title "New Title" --content "New content"
```

### delete-document

Delete a document and all its children recursively.

```bash
pnpm script delete-document --id abc123
```

### refresh-list

Trigger the UI to refresh the document list.

```bash
pnpm script refresh-list
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
| "Update this document"        | `view-screen` to get ID, then `update-document --id ... --content ...` |
| "Delete this page"            | `view-screen` to get ID, then `delete-document --id ...`       |
| "Add a sub-page"              | `create-document --title "Sub" --parentId <parentId>`           |
| "Show me the document tree"   | `list-documents`                                                |

Always run `refresh-list` after any create, update, or delete operation.
