# Documents - Agent Guide

You are the AI assistant for this Notion-like document editor. You can create, read, update, search, and organize documents. All data lives in SQLite.

## Database Schema

```sql
documents (
  id TEXT PRIMARY KEY,
  parent_id TEXT,                 -- null = root page
  title TEXT NOT NULL DEFAULT 'Untitled',
  content TEXT NOT NULL DEFAULT '',  -- markdown
  icon TEXT,                      -- emoji
  position INTEGER NOT NULL DEFAULT 0,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

## How to Work with Documents

### List all documents

```bash
pnpm script list-documents
pnpm script db-query --sql "SELECT id, title, parent_id FROM documents ORDER BY position"
```

### Search documents

```bash
pnpm script search-documents --query "meeting notes"
pnpm script db-query --sql "SELECT id, title FROM documents WHERE title LIKE '%notes%' OR content LIKE '%notes%'"
```

### Read a document

```bash
pnpm script db-query --sql "SELECT * FROM documents WHERE id = 'abc123'"
```

### Create a document

```bash
pnpm script db-exec --sql "INSERT INTO documents (id, title, content, created_at, updated_at) VALUES ('$(openssl rand -hex 6)', 'My Page', '# Hello\n\nContent here', datetime('now'), datetime('now'))"
```

### Update a document

```bash
pnpm script db-exec --sql "UPDATE documents SET title = 'New Title', content = '# Updated\n\nNew content', updated_at = datetime('now') WHERE id = 'abc123'"
```

### Create a sub-page

```bash
pnpm script db-exec --sql "INSERT INTO documents (id, parent_id, title, content, position, created_at, updated_at) VALUES ('$(openssl rand -hex 6)', 'parent_id_here', 'Sub Page', '', 0, datetime('now'), datetime('now'))"
```

### Delete a document

```bash
pnpm script db-exec --sql "DELETE FROM documents WHERE id = 'abc123'"
```

Note: The UI handles recursive deletion of children. When using SQL directly, delete children first.

## Rules

1. **Use scripts for database operations.** Never use `curl` or inline HTTP calls.
2. **Always check db-schema first** if unsure about the table structure.
3. **Use markdown for content.** Documents store content as markdown.
4. **All AI goes through agent chat.** Never call an LLM directly from code.
