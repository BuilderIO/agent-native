---
name: sse-file-watcher
description: >-
  How to keep the UI in sync with agent changes via Server-Sent Events. Use
  when setting up real-time data sync, wiring query invalidation for new data
  models, or debugging UI not updating.
---

# SSE Database Watcher

## Rule

The UI stays in sync with agent changes through Server-Sent Events. When the agent writes data (via settings API, Drizzle, or application-state), the UI updates automatically — no polling, no manual refresh.

## Why

The agent modifies data in the SQL database, but the UI runs in the browser. SSE bridges this gap: the server detects DB changes, streams events to the browser, and React Query invalidates the relevant caches. This is what makes SQL-backed data feel real-time.

## How It Works

1. **Server** streams DB change events via SSE:

   ```ts
   import { createSSEHandler } from "@agent-native/core";
   app.get("/api/events", createSSEHandler());
   ```

2. **Client** listens for changes and invalidates React Query caches:

   ```ts
   import { useSSE } from "@agent-native/core";
   useSSE({ queryClient, queryKeys: ["settings", "dashboards"] });
   ```

3. When the agent writes data (e.g., `putSetting("dashboard-weekly-signups", ...)`), the server detects the change, SSE pushes the event, and React Query refetches the affected queries.

## Don't

- Don't poll for changes — SSE handles it
- Don't create your own EventSource connections alongside `useSSE` — use the `onEvent` callback for custom handling
- Don't use `createFileWatcher` for data watching — DB change events replace file watching

## Query Key Mapping

By default, `useSSE` invalidates all listed query keys on every change event. For apps with multiple data models, this causes unnecessary refetches. Use the `onEvent` callback for targeted invalidation:

```ts
useSSE({
  queryClient,
  queryKeys: [], // don't auto-invalidate everything
  onEvent: (data) => {
    if (data.key?.includes("dashboard")) {
      queryClient.invalidateQueries({ queryKey: ["dashboards"] });
    } else if (data.key?.includes("settings")) {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    }
  },
});
```

To prevent cache thrashing during rapid agent writes, set `staleTime` on your queries:

```ts
useQuery({
  queryKey: ["dashboards"],
  queryFn: fetchDashboards,
  staleTime: 2000, // don't refetch within 2 seconds
});
```

## Performance

When the agent writes rapidly (e.g., during batch operations), each write fires an SSE event and React Query invalidation. This can cause excessive refetching.

Mitigations:

- Use `staleTime: 2000` on React Query to debounce refetches
- Use targeted invalidation (see Query Key Mapping) to limit which queries invalidate

## Troubleshooting

| Symptom                            | Check                                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| UI not updating after agent writes | Is `useSSE` called with the correct `queryClient`? Are the `queryKeys` matching your `useQuery` keys?     |
| SSE not firing                     | Open browser devtools -> Network tab -> filter by EventStream. Is `/api/events` connected?                |
| Constant reconnections             | Check for server crashes in terminal output.                                                              |
| High CPU / event storms            | The agent is writing data rapidly. Add `staleTime` to queries and use targeted invalidation.              |

## Related Skills

- **files-as-database** — SSE watches the SQL database that stores application state
- **scripts** — Script writes to the database trigger SSE events
- **self-modifying-code** — Agent code edits trigger SSE events; rapid edits can cause event storms
