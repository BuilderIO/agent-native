# Documents

A Notion-like document editor built with the agent-native framework. Create and organize hierarchical pages with rich text editing.

## Features

- Hierarchical pages (unlimited nesting)
- Rich text editor (Tiptap) with slash commands
- Favorites for quick access
- Full-text search
- Agent can create, read, update, and search documents
- Auto-save with debouncing
- Dark/light theme

## Getting Started

```bash
pnpm install
pnpm dev
```

Open http://localhost:8080 and create your first page.

## Data

Documents are stored in the app's SQL database. Local development defaults to SQLite at `data/app.db`; deployed apps should set `DATABASE_URL` to a persistent SQL database. The agent should use content actions for normal document operations and reserve `db-query` / `db-exec` for inspection or maintenance.
