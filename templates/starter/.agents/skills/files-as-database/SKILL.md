---
name: files-as-database
description: >-
  How to store and manage application state as JSON/markdown files in data/.
  Use when adding data models, creating file-based state, deciding where to
  store data, or reading/writing application data files.
---

# Files as Database

## Rule

All application state must be stored as files. There is no traditional database in an agent-native app.

## Why

Files are the shared interface between the AI agent and the UI. The agent reads and writes files directly on the filesystem. The UI reads files via API routes. SSE streams file changes back to the UI in real-time. This only works if files are the single source of truth.

## How

- Store data as JSON or markdown files in `data/` (or a project-specific subdirectory).
- API routes in `server/index.ts` read files with `fs.readFile` and return them.
- The agent modifies files directly — no API calls needed from the agent side.
- `createFileWatcher("./data")` watches for changes and streams them via SSE.
- `useFileWatcher()` on the client invalidates React Query caches when files change.

## Don't

- Don't add a database (SQLite, Postgres, MongoDB, etc.)
- Don't store app state in localStorage, sessionStorage, or cookies
- Don't keep state only in memory (server variables, global stores)
- Don't use Redis or any external state store
- Don't interpolate user input directly into file paths (see Security below)

## Example

```ts
import fs from "fs";

// Writing state (agent or script)
fs.writeFileSync(
  "data/projects/my-project.json",
  JSON.stringify(project, null, 2),
);

// Reading state (server route) — note the path sanitization
app.get("/api/projects/:id", (req, res) => {
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, "");
  const data = fs.readFileSync(`data/projects/${id}.json`, "utf-8");
  res.json(JSON.parse(data));
});
```

## Creating a New Data Model

When adding a new data entity (e.g., projects, tasks, settings):

1. **Define the type** in `shared/` so both client and server import it
2. **Create the data directory** — `data/<model>/<id>.json` (one file per item) or `data/<model>.json` (single collection)
3. **Add API routes** in `server/` that read/write the files (sanitize IDs from params)
4. **Wire SSE invalidation** — Add the query key to `useFileWatcher()` so the UI refreshes on changes

## Judgment Criteria

| Question                             | Single file       | Directory of files           |
| ------------------------------------ | ----------------- | ---------------------------- |
| Are items independently addressable? | No — use one file | Yes — one file per item      |
| Will there be >50 items?             | Probably fine     | Definitely split             |
| Do items need individual URLs?       | No                | Yes                          |
| Do items change independently?       | No                | Yes — avoids write conflicts |

## Scaling Guidance

| File Count | Recommendation                                                        |
| ---------- | --------------------------------------------------------------------- |
| Under 50   | Read-all with `readdirSync` + `readFileSync` is fine                  |
| 50–200     | Add an index file (`data/<model>/_index.json`) with IDs and summaries |
| 200+       | Partition into subdirectories                                         |

For list endpoints serving many files, use `fs.promises.readFile` instead of `readFileSync` to avoid blocking the event loop.

## Security

- **Path sanitization** — Always sanitize IDs from request params before constructing file paths. Use `id.replace(/[^a-zA-Z0-9_-]/g, "")` or the core utility `isValidPath()`. Without this, `../../.env` as an ID reads your environment file.
- **Validate before writing** — Check data shape before writing files, especially for user-submitted data. A malformed write can break all subsequent reads.

## Related Skills

- **sse-file-watcher** — Set up real-time sync so the UI updates when data files change
- **scripts** — Create scripts that read/write data files for complex operations
- **self-modifying-code** — The agent writes data files as Tier 1 (auto-apply) modifications
