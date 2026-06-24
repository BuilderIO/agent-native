# Content

Open-source Obsidian for MDX, built with the agent-native framework. Edit local
Markdown/MDX files, generate rich interactive custom blocks, and organize
hierarchical pages with an AI agent.

## Features

- Hierarchical pages (unlimited nesting)
- Rich text editor (Tiptap) with slash commands
- Favorites for quick access
- Full-text search
- Local Markdown/MDX file editing
- Custom interactive MDX blocks from local components
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

## Enable Builder live writes

Builder live writes let edits to a Builder-backed database row push to Builder as an `autoSaveOnly` revision. Autosave never changes the live/published artifact; it stages a revision that Builder surfaces in its editor.

Connect Builder through the existing Builder Connect flow, the same connection used by the AI assistant. Once connected, Content resolves the key automatically for the user, or for org owners/admins through the org connection. There is no separate key entry. In local development, `BUILDER_PRIVATE_KEY` and `BUILDER_PUBLIC_KEY` in `.env.local` also work; see `DEVELOPING.md` for local env opt-in details.

Live writes are only allowed for the safe write model `agent-native-blog-article-test` (`BUILDER_CMS_SAFE_WRITE_MODEL`). Other Builder models stay read-only by design.

To enable them, attach a Builder source on that safe model, then flip the **Enable writes** toggle next to the source status badge. Agents can do the same with `set-content-database-source-write-mode`. The toggle enables autosave-only mode; draft and publish modes require separate explicit opt-in.

Before any Builder write runs, Content requires live writes to be enabled, the safe model, an approved outbound change-set, a prepared execution gate, and a matching idempotency key. Body diffs are not executable yet; this lane only covers metadata updates on existing Builder entries.
