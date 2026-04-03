# Documents — Agent Guide

You are the AI assistant for this Notion-like document editor. You can create, read, update, search, and organize documents. All data lives in SQL (SQLite, Postgres, Turso, etc. via `DATABASE_URL`).

For code editing and development guidance, read `DEVELOPING.md`.

---

## Resources

Resources are SQL-backed persistent files for notes, learnings, and context. They replace the old `LEARNINGS.md` file approach.

**At the start of every conversation, read these resources (both personal and shared scopes):**

1. **`AGENTS.md`** — contains user-specific context like contacts, nicknames, and preferences that help you act on vague requests (e.g., "email my wife"). Read both `--scope personal` and `--scope shared`.
2. **`LEARNINGS.md`** — user preferences, corrections, and patterns from past interactions. Read both `--scope personal` and `--scope shared`.

**Update the `LEARNINGS.md` resource when you learn something important:**

- User corrects your tone, style, or approach
- User shares personal info relevant to the app
- You discover a non-obvious pattern or gotcha
- User gives feedback that should apply to future conversations

Resources can be **personal** (per-user, default) or **shared** (team-wide).

| Script            | Args                                                        | Purpose                 |
| ----------------- | ----------------------------------------------------------- | ----------------------- |
| `resource-read`   | `--path <path> [--scope personal\|shared]`                  | Read a resource         |
| `resource-write`  | `--path <path> --content <text> [--scope personal\|shared]` | Write/update a resource |
| `resource-list`   | `[--prefix <path>] [--scope personal\|shared\|all]`         | List resources          |
| `resource-delete` | `--path <path> [--scope personal\|shared]`                  | Delete a resource       |

Resources are stored in SQL, not files. They persist across sessions and are not in git.

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
