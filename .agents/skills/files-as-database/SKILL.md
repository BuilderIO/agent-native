---
name: files-as-database
description: >-
  How to choose between files and SQLite for storing application state. Use when
  adding data models, deciding where to store data, or reading/writing
  application data.
---

# Files vs SQLite — Choosing the Right Data Layer

## Rule

Agent-native apps use **two data layers**: files for content and configuration, SQLite for structured application data. Choose the right one based on what you're storing.

## When to Use Files

Store data as files in `data/` (JSON, markdown, images) when:

- **Content** — markdown documents, drafts, articles, slide decks
- **Settings/Configuration** — app settings, user preferences, sync config
- **Application state** — ephemeral UI state in `application-state/` (compose windows, search state)
- **Media** — images, uploads, generated assets
- **Data the agent edits directly** — the agent can read/write files on the filesystem without going through an API

Files are the shared interface between the AI agent and the UI. The agent reads and writes files directly. The UI reads files via API routes. SSE streams file changes back to the UI in real-time.

### How (Files)

- Store data as JSON or markdown files in `data/` (or a project-specific subdirectory).
- API routes in `server/routes/` read files with `fs.readFile` and return them.
- The agent modifies files directly — no API calls needed from the agent side.
- `createFileWatcher("./data")` watches for changes and streams them via SSE.
- `useFileWatcher()` on the client invalidates React Query caches when files change.

### File Organization

| Question                             | Single file       | Directory of files           |
| ------------------------------------ | ----------------- | ---------------------------- |
| Are items independently addressable? | No — use one file | Yes — one file per item      |
| Will there be >50 items?             | Probably fine     | Definitely split             |
| Do items need individual URLs?       | No                | Yes                          |
| Do items change independently?       | No                | Yes — avoids write conflicts |

## When to Use SQLite

Store data in SQLite (`data/app.db`) via Drizzle ORM + `@libsql/client` when:

- **Structured records** — forms, bookings, submissions, compositions with relationships
- **Data that needs querying** — filtering, sorting, aggregation, joins
- **High-volume data** — hundreds or thousands of records
- **Relational data** — foreign keys, references between entities
- **Data that benefits from transactions** — atomic multi-table writes

### How (SQLite)

- Define schema with Drizzle ORM in `server/db/schema.ts`.
- Get a database instance with `const db = getDb()` from `server/db/index.ts`.
- All queries are **async** (using `@libsql/client`, not `better-sqlite3`).
- The agent uses DB scripts (`pnpm script db-schema`, `db-query`, `db-exec`) or app-specific scripts to read/write data.
- Set `DATABASE_URL` env var for cloud database (Turso); defaults to local `file:data/app.db`.

### Cloud Upgrade Path

Local SQLite works out of the box. To upgrade to a cloud database:

1. Set `DATABASE_URL` to a Turso URL (e.g. `libsql://your-db.turso.io`)
2. Set `DATABASE_AUTH_TOKEN` to your Turso auth token
3. No code changes needed — `@libsql/client` handles both local and remote

## Don't

- Don't store structured app data (forms, bookings, records) as individual JSON files when you need querying
- Don't store app state in localStorage, sessionStorage, or cookies
- Don't keep state only in memory (server variables, global stores)
- Don't use Redis or any external state store for app data
- Don't interpolate user input directly into file paths (see Security below)

## Examples by Template

| Template   | Files                                            | SQLite                             |
| ---------- | ------------------------------------------------ | ---------------------------------- |
| **Forms**  | `data/settings.json`                             | forms, responses                   |
| **Calendar** | `data/settings.json`, `data/availability.json` | bookings                           |
| **Slides** | `data/decks/*.json`                              | (not used — decks are JSON files)  |
| **Content** | `content/projects/**/*.md`, `*.json`            | (not used — content is files)      |
| **Videos** | compositions in registry                         | (not used — state in localStorage) |

## Security

- **Path sanitization** — Always sanitize IDs from request params before constructing file paths. Use `id.replace(/[^a-zA-Z0-9_-]/g, "")` or the core utility `isValidPath()`. Without this, `../../.env` as an ID reads your environment file.
- **Validate before writing** — Check data shape before writing files, especially for user-submitted data. A malformed write can break all subsequent reads.
- **SQL injection** — Use Drizzle ORM's query builder, never raw string interpolation for SQL queries.

## Route Loaders vs API Routes

React Router route `loader` functions can fetch data server-side during SSR. However, the default pattern is **SSR shell + client rendering**: the server renders a loading spinner and the client fetches data from `/api/*` routes via React Query. Only use server `loader` when a page genuinely needs server-rendered content for SEO or og tags (e.g., public booking pages). For all app pages behind auth, stick with the client-side React Query pattern.

## Related Skills

- **sse-file-watcher** — Set up real-time sync so the UI updates when data files change
- **scripts** — Create scripts that read/write data files or query the database
- **self-modifying-code** — The agent writes data files as Tier 1 (auto-apply) modifications
