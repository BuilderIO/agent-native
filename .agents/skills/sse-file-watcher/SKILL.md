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

## Query Key Mapping

By default, `useFileWatcher` invalidates all listed query keys on every file change. For apps with multiple data models, this causes unnecessary refetches. Use path-based filtering via the `onEvent` callback:

```ts
useFileWatcher({
  queryClient,
  queryKeys: [], // don't auto-invalidate everything
  onEvent: (data) => {
    if (data.path?.includes("projects")) {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    } else if (data.path?.includes("settings")) {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    }
  },
});
```

To prevent cache thrashing during rapid agent writes, set `staleTime` on your queries:

```ts
useQuery({
  queryKey: ["projects"],
  queryFn: fetchProjects,
  staleTime: 2000, // don't refetch within 2 seconds
});
```

## Dependency Array

The `useFileWatcher` hook spreads `queryKeys` into its `useEffect` dependency array. If `queryKeys` is a new array reference on every render, the EventSource will disconnect and reconnect on every render. Fix: use a stable reference.

```ts
// Bad: new array every render → reconnects constantly
useFileWatcher({ queryClient, queryKeys: ["projects", "tasks"] });

// Good: stable reference
const QUERY_KEYS = ["projects", "tasks"];
useFileWatcher({ queryClient, queryKeys: QUERY_KEYS });

// Also good: useMemo
const keys = useMemo(() => ["projects", "tasks"], []);
useFileWatcher({ queryClient, queryKeys: keys });
```

## Performance

When the agent writes many files rapidly (e.g., during self-modification), each write fires a chokidar event → SSE broadcast → React Query invalidation. This can cause excessive refetching.

Mitigations:
- Use `staleTime: 2000` on React Query to debounce refetches
- Use path-based filtering (see Query Key Mapping) to limit which queries invalidate

## Troubleshooting

| Symptom | Check |
|---|---|
| UI not updating after agent writes | Is `useFileWatcher` called with the correct `queryClient`? Are the `queryKeys` matching your `useQuery` keys? |
| SSE not firing | Open browser devtools → Network tab → filter by EventStream. Is `/api/events` connected? Is the server running? |
| Watcher not detecting changes | Is the path correct? `createFileWatcher("./data")` is relative to CWD. Check the server's working directory. |
| Constant reconnections | Check if `queryKeys` is a stable reference (see Dependency Array above). Also check for server crashes in terminal output. |
| High CPU / event storms | The agent is writing many files rapidly. Add `staleTime` to queries and use path-based filtering. |

## Related Skills

- **files-as-database** — SSE watches the data files that store application state
- **scripts** — Script outputs written to `data/` trigger SSE events
- **self-modifying-code** — Agent code edits trigger SSE events; rapid edits can cause event storms
