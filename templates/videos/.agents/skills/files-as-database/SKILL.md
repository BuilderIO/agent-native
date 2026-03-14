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

## Example

```ts
// Writing state (agent or script)
fs.writeFileSync("data/projects/my-project.json", JSON.stringify(project, null, 2));

// Reading state (server route)
app.get("/api/projects/:id", (req, res) => {
  const data = fs.readFileSync(`data/projects/${req.params.id}.json`, "utf-8");
  res.json(JSON.parse(data));
});
```
