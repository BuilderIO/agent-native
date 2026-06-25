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

Connect Builder through the existing Builder Connect flow, the same connection used by the AI assistant. Once connected, Content resolves the key automatically for the user, or for org owners/admins through the org connection. There is no separate key entry. In local development, `BUILDER_PRIVATE_KEY` and `BUILDER_PUBLIC_KEY` in `.env.local` also work; see `DEVELOPING.md` for local env opt-in details.

Live writes are only allowed for the safe write model `agent-native-blog-article-test` (`BUILDER_CMS_SAFE_WRITE_MODEL`). Other Builder models stay read-only by design.

Write access is an intentional per-source choice from the source panel selector. Sources start at `read_only`, can move to `stage_only` to push approved changes as Builder autosave revisions, and can move to `publish_updates` for state-preserving live writes. Autosave staging stays quiet; update-in-place and publish writes trigger Builder webhooks so downstream rebuilds can run.

In `publish_updates`, Content PATCHes the Builder entry in place and preserves its current publication state: published entries stay published and drafts stay draft. Content never sends a `published` field, so a normal content push cannot publish or unpublish. Builder merges the field changes and preserves the entry envelope, including scheduling and targeting.

Publication transitions are explicit per-row choices in the review/diff, only when the source enables **Allow publish/unpublish per item**. Publishing a draft or unpublishing a published entry is never a bulk default, and unpublish requires confirmation because it takes live content down. New Builder entries are created as drafts.

**Push all approved (N)** runs approved rows in a concurrency-capped batch. It continues after individual errors, reports per-item `succeeded`, `blocked`, or `failed` status, and can be resumed because already-succeeded items are skipped.

Before each write, Content reads the target's current state from Builder. A write blocks if the entry changed or was deleted since the diff, or if a requested publish/unpublish transition no longer matches the real Builder state. Body diffs remain non-executable for now; they are planned for a later slice.
