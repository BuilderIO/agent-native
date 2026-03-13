---
name: sse-file-watcher
description: >-
  How to keep the UI in sync with agent changes via Server-Sent Events. Use
  when setting up real-time file sync, adding SSE to a new data directory,
  wiring query invalidation for new data models, or debugging UI not updating.
---

# SSE File Watcher

## Rule

The UI stays in sync with agent changes through Server-Sent Events. When the agent writes a file, the UI updates automatically — no polling, no manual refresh.

## Why

The agent modifies files on disk, but the UI runs in the browser. SSE bridges this gap: a file watcher on the server detects changes, streams them to the browser, and React Query invalidates the relevant caches. This is what makes the "files as database" pattern feel real-time.

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

## Don't

- Don't poll for changes — SSE handles it
- Don't create per-model `fs.watch()` instances — `createFileWatcher("./data")` watches recursively. One watcher is enough.
- Don't spread `queryKeys` inline on every render — use a stable reference (see Dependency Array below)
- Don't create your own EventSource connections alongside `useFileWatcher` — use the `onEvent` callback for custom handling

## Multiple Directories

`createFileWatcher("./data")` watches the entire `data/` tree recursively. You do NOT need separate watchers per data model. If you have data in multiple top-level directories, create one watcher per directory and pass both to `createSSEHandler`:

```ts
const dataWatcher = createFileWatcher("./data");
const configWatcher = createFileWatcher("./config");
// Use extraEmitters to combine multiple sources
app.get("/api/events", createSSEHandler(dataWatcher));
```

## Query Key Mapping

By default, `useFileWatcher` invalidates all listed query keys on every file change. For apps with multiple data models, this causes unnecessary refetches. Use path-based filtering via the `onEvent` callback:

```ts
useFileWatcher({
  queryClient,
  queryKeys: [], // don't auto-invalidate everything
  onEvent: (data) => {
    if (data.path?.includes("decks")) {
      queryClient.invalidateQueries({ queryKey: ["decks"] });
    } else if (data.path?.includes("settings")) {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    }
  },
});
```

To prevent cache thrashing during rapid agent writes, set `staleTime` on your queries:

```ts
useQuery({
  queryKey: ["decks"],
  queryFn: fetchDecks,
  staleTime: 2000, // don't refetch within 2 seconds
});
```

## Reconnection

`EventSource` has built-in automatic reconnection — if the SSE connection drops, the browser reconnects automatically. Handle errors for logging:

```ts
useFileWatcher({
  queryClient,
  queryKeys: ["files"],
  // The hook already logs errors; add onEvent for custom error handling
});
```

If the server restarts, the EventSource reconnects and the UI catches up on the next file change.

## Dependency Array

The `useFileWatcher` hook spreads `queryKeys` into its `useEffect` dependency array. If `queryKeys` is a new array reference on every render, the EventSource will disconnect and reconnect on every render. Fix: use a stable reference.

```ts
// Bad: new array every render → reconnects constantly
useFileWatcher({ queryClient, queryKeys: ["decks", "slides"] });

// Good: stable reference
const QUERY_KEYS = ["decks", "slides"];
useFileWatcher({ queryClient, queryKeys: QUERY_KEYS });

// Also good: useMemo
const keys = useMemo(() => ["decks", "slides"], []);
useFileWatcher({ queryClient, queryKeys: keys });
```

## Performance

**SSE event storms** — When the agent writes many files rapidly (e.g., 15 files in 2 seconds during self-modification), each write fires a chokidar event → SSE broadcast → React Query invalidation. With 4 query keys, that's 60 `invalidateQueries` calls.

Mitigations:
- Use `staleTime: 2000` on React Query to debounce refetches
- Use path-based filtering (see Query Key Mapping) to limit which queries invalidate
- On Linux with many directories, you may need to increase `fs.inotify.max_user_watches`

**Connection limits** — Browsers limit concurrent SSE connections per domain (typically 6 for HTTP/1.1). For production with multiple tabs, consider HTTP/2 or a shared connection strategy.

## Troubleshooting

| Symptom | Check |
|---|---|
| UI not updating after agent writes | Is `useFileWatcher` called with the correct `queryClient`? Are the `queryKeys` matching your `useQuery` keys? |
| SSE not firing | Open browser devtools → Network tab → filter by EventStream. Is `/api/events` connected? Is the server running? |
| Watcher not detecting changes | Is the path correct? `createFileWatcher("./data")` is relative to CWD. Check the server's working directory. |
| Constant reconnections | Check if `queryKeys` is a stable reference (see Dependency Array above). Also check for server crashes in terminal output. |
| High CPU / event storms | The agent is writing many files rapidly. Add `staleTime` to queries and use path-based filtering. |

## Security

- **Strip absolute paths** — SSE events include file paths. The `createSSEHandler` sends the path as chokidar reports it (relative to the watched directory). Avoid exposing absolute filesystem paths to the browser.
- **Authentication** — In production, add authentication to the `/api/events` endpoint. Without it, anyone can stream all file changes.
- **Connection limits** — Cap concurrent SSE connections to prevent resource exhaustion.

## Related Skills

- **files-as-database** — SSE watches the data files that store application state
- **scripts** — Script outputs written to `data/` trigger SSE events
- **self-modifying-code** — Agent code edits trigger SSE events; rapid edits can cause event storms
