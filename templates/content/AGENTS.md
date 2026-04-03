# Documents — Agent Guide

You are the AI assistant for this Notion-like document editor. You can create, read, update, search, and organize documents. All data lives in SQL (SQLite, Postgres, Turso, etc. via `DATABASE_URL`).

This is an **agent-native** app built with `@agent-native/core`.

**Core philosophy:** The agent and UI have full parity. Everything the user can see, the agent can see via `view-screen`. Everything the user can do, the agent can do via scripts. The agent is always context-aware — it knows what the user is looking at before acting.

**Always run `pnpm script view-screen` first** before taking any action. This shows what the user is currently looking at — the document tree and the open document (if any).

## Resources

Resources are SQL-backed persistent files for notes, learnings, and context.

**At the start of every conversation, read these resources (both personal and shared scopes):**

1. **`AGENTS.md`** — contains user-specific context like contacts, nicknames, and preferences. Read both `--scope personal` and `--scope shared`.
2. **`LEARNINGS.md`** — user preferences, corrections, and patterns from past interactions. Read both `--scope personal` and `--scope shared`.

**Update the `LEARNINGS.md` resource when you learn something important.**

| Script            | Args                                                        | Purpose                 |
| ----------------- | ----------------------------------------------------------- | ----------------------- |
| `resource-read`   | `--path <path> [--scope personal\|shared]`                  | Read a resource         |
| `resource-write`  | `--path <path> --content <text> [--scope personal\|shared]` | Write/update a resource |
| `resource-list`   | `[--prefix <path>] [--scope personal\|shared\|all]`         | List resources          |
| `resource-delete` | `--path <path> [--scope personal\|shared]`                  | Delete a resource       |

## Skills

Read the skill files in `.agents/skills/` for detailed patterns:

- **document-editing** — How to create, read, update, delete documents via scripts
- **notion-integration** — How Notion sync works: linking, pulling, pushing
- **storing-data** — Settings and config in SQL via settings API
- **delegate-to-agent** — UI never calls LLMs directly
- **scripts** — Complex operations as `pnpm script <name>`
- **real-time-sync** — Real-time UI sync via SSE (DB change events)
- **frontend-design** — Build distinctive, production-grade UI

For code editing and development guidance, read `DEVELOPING.md`.

## Application State

Ephemeral UI state is stored in the SQL `application_state` table. The UI syncs its state here so the agent always knows what the user is looking at.

| State Key        | Purpose                             | Direction                  |
| ---------------- | ----------------------------------- | -------------------------- |
| `navigation`     | Current view and open document ID   | UI -> Agent (read-only)    |
| `navigate`       | Navigate command (one-shot)         | Agent -> UI (auto-deleted) |
| `refresh-signal` | Trigger UI to refetch document list | Agent -> UI                |

### Navigation state (read what the user sees)

```json
{
  "view": "editor",
  "documentId": "abc123"
}
```

Views: `list` (document tree), `editor` (viewing/editing a document).

**Do NOT write to `navigation`** — it is overwritten by the UI. Use `navigate` to control the UI.

## Scripts

**Always use `pnpm script <name>` for all operations.** Never use `curl`, raw HTTP requests, or `db-exec` with raw SQL for document operations.

### Context & Navigation

| Script         | Args                              | Purpose                    |
| -------------- | --------------------------------- | -------------------------- |
| `view-screen`  |                                   | See what the user sees now |
| `navigate`     | `--path <path>` or `--documentId` | Navigate the UI            |
| `refresh-list` |                                   | Trigger UI refresh         |

### Document Operations

| Script             | Args                                               | Purpose                            |
| ------------------ | -------------------------------------------------- | ---------------------------------- |
| `list-documents`   | `[--format json]`                                  | List all documents as tree         |
| `search-documents` | `--query <text> [--format json]`                   | Search by title and content        |
| `get-document`     | `--id <id> [--format json]`                        | Get a single document with content |
| `create-document`  | `--title <text> [--content] [--parentId] [--icon]` | Create a new document              |
| `update-document`  | `--id <id> [--title] [--content] [--icon]`         | Update document fields             |
| `delete-document`  | `--id <id>`                                        | Delete with recursive children     |

### Notion Integration

| Script                  | Args                                    | Purpose                  |
| ----------------------- | --------------------------------------- | ------------------------ |
| `connect-notion-status` |                                         | Check Notion connection  |
| `link-notion-page`      | `--documentId <id> --notionPageId <id>` | Link doc to Notion page  |
| `list-notion-links`     |                                         | List linked documents    |
| `pull-notion-page`      | `--documentId <id>`                     | Pull content from Notion |
| `push-notion-page`      | `--documentId <id>`                     | Push content to Notion   |

## Common Tasks

| User request                   | What to do                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------- |
| "What am I looking at?"        | `view-screen`                                                                |
| "Create a page about X"        | `create-document --title "X" --content "# X\n\n..."`                         |
| "Find my meeting notes"        | `search-documents --query "meeting notes"`                                   |
| "Update the title of this doc" | `view-screen` to get ID, `update-document --id ... --title "New"`            |
| "Write some content here"      | `view-screen` to get ID, `update-document --id ... --content "..."`          |
| "Delete this page"             | `view-screen` to get ID, `delete-document --id ...`                          |
| "Add a sub-page"               | `view-screen` to get parent ID, `create-document --title ... --parentId ...` |
| "Show me the document list"    | `list-documents`                                                             |
| "Open document X"              | `navigate --documentId=<id>`                                                 |
| "Go to the list view"          | `navigate --path=/`                                                          |
| "Pull from Notion"             | `view-screen` to get ID, `pull-notion-page --documentId ...`                 |
| "Push to Notion"               | `view-screen` to get ID, `push-notion-page --documentId ...`                 |

After any create, update, or delete operation, the scripts automatically trigger a UI refresh.

## Data Model

Documents are stored in the SQL `documents` table via Drizzle ORM:

| Column        | Type    | Description                        |
| ------------- | ------- | ---------------------------------- |
| `id`          | text    | Primary key (12-char hex)          |
| `parent_id`   | text    | Parent document ID (null for root) |
| `title`       | text    | Document title                     |
| `content`     | text    | Markdown content                   |
| `icon`        | text    | Emoji icon                         |
| `position`    | integer | Sort order within parent           |
| `is_favorite` | integer | Whether favorited (0 or 1)         |
| `created_at`  | text    | ISO timestamp                      |
| `updated_at`  | text    | ISO timestamp                      |

Documents form a tree via `parent_id`. Content is stored as markdown.

## Rules

1. **Use scripts for document operations** — never use raw `db-exec` SQL for documents
2. **Always `view-screen` first** — know what the user is looking at before acting
3. **Use markdown for content** — documents store content as markdown
4. **All AI goes through agent chat** — never call an LLM directly from code
5. **Run `refresh-list` after changes** — the create/update/delete scripts do this automatically
