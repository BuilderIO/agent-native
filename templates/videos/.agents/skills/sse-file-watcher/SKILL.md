# SSE File Watcher

## Rule

The UI stays in sync with agent changes through Server-Sent Events. When the agent writes a file, the UI updates automatically — no polling, no manual refresh.

## How It Works

1. **Server** watches the data directory with chokidar:
   ```ts
   import { createFileWatcher, createSSEHandler } from "@agent-native/core";
   const watcher = createFileWatcher("./data");
   app.get("/api/events", createSSEHandler(watcher));
   ```

2. **Client** listens for changes and invalidates React Query caches:
   ```ts
   import { useFileWatcher } from "@agent-native/core";
   useFileWatcher({ queryClient, queryKeys: ["files", "projects"] });
   ```

3. When the agent writes to `data/`, chokidar detects it, SSE pushes the event, and React Query refetches the affected queries.

## Guidelines

- Watch the `data/` directory (or wherever your app stores state files).
- List the React Query keys that should refresh when files change in `queryKeys`.
- The watcher uses `ignoreInitial: true` — it only fires on changes after startup.
- Don't poll for changes. SSE handles it.
- For production, `createProductionServer()` handles graceful shutdown of watchers.
