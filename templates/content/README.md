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

All documents are stored in SQLite (`data/app.db`). The agent can query and modify documents using the built-in `db-query` and `db-exec` scripts.
