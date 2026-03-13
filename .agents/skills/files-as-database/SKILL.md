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
fs.writeFileSync("data/projects/my-project.json", JSON.stringify(project, null, 2));

// Reading state (server route) — note the path sanitization
app.get("/api/projects/:id", (req, res) => {
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, "");
  const data = fs.readFileSync(`data/projects/${id}.json`, "utf-8");
  res.json(JSON.parse(data));
});
```

## Creating a New Data Model

When adding a new data entity (e.g., projects, tasks, settings), follow this checklist:

1. **Design the JSON schema** — Define the shape in `shared/` so both client and server import the same type:
   ```ts
   // shared/api.ts
   export interface Project {
     id: string;
     name: string;
     createdAt: string;
   }
   ```

2. **Create the data directory** — Store items as `data/<model>/<id>.json` (one file per item) or `data/<model>.json` (single collection file).

3. **Add API routes** — CRUD routes in `server/` that read/write the files:
   ```ts
   import fs from "fs";
   import path from "path";
   import { isValidPath } from "@agent-native/core";

   app.get("/api/projects/:id", (req, res) => {
     const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, "");
     const filePath = path.join("data/projects", `${id}.json`);
     if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Not found" });
     const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
     res.json(data);
   });
   ```

4. **Wire SSE invalidation** — Add the query key to your `useFileWatcher()` call so the UI refreshes when files change:
   ```ts
   useFileWatcher({ queryClient, queryKeys: ["projects", "decks"] });
   ```

5. **Type your JSON.parse calls** — Every `JSON.parse` is a type safety hole. Use `as Type` for internal data; consider Zod validation for user-submitted data:
   ```ts
   const raw = fs.readFileSync(filePath, "utf-8");
   const project = JSON.parse(raw) as Project;
   ```

## Judgment Criteria

When deciding how to structure your data files:

| Question | Single file | Directory of files |
|---|---|---|
| Are items independently addressable? | No — use one file | Yes — one file per item |
| Will there be >50 items? | Probably fine | Definitely split |
| Do items need individual URLs? | No | Yes |
| Do items change independently? | No | Yes — avoids write conflicts |

## Scaling Guidance

| File Count | Recommendation |
|---|---|
| Under 50 | Read-all with `readdirSync` + `readFileSync` is fine |
| 50–200 | Add an index file (`data/projects/_index.json`) with IDs and summaries |
| 200+ | Partition into subdirectories (`data/projects/a-f/`, `data/projects/g-m/`, etc.) |

For list endpoints serving many files, use `fs.promises.readFile` instead of `readFileSync` to avoid blocking the event loop.

## Security

- **Path sanitization** — Always sanitize IDs from request params before constructing file paths. Use `id.replace(/[^a-zA-Z0-9_-]/g, "")` or the core utility `isValidPath()`. Without this, `../../.env` as an ID reads your environment file.
- **JSON schema validation** — Validate data shape before writing files, especially for user-submitted data. A malformed write can break all subsequent reads.
- **File size limits** — Cap write sizes to prevent denial-of-service via massive payloads (`if (JSON.stringify(data).length > MAX_SIZE) return res.status(413)...`).
- **Prototype pollution** — Be cautious with `JSON.parse` on untrusted input. Properties like `__proto__` or `constructor` can pollute object prototypes.

## Related Skills

- **sse-file-watcher** — Set up real-time sync so the UI updates when data files change
- **scripts** — Create scripts that read/write data files for complex operations
- **self-modifying-code** — The agent writes data files as Tier 1 (auto-apply) modifications
