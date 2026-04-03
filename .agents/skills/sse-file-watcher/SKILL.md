---
name: real-time-sync
description: >-
  How to keep the UI in sync with agent changes via polling. Use when wiring
  query invalidation for new data models, debugging UI not updating, or
  understanding jitter prevention.
---

> **Also known as:** `real-time-sync`. The skill table in AGENTS.md references this skill as `real-time-sync`.

# Real-Time Sync (Polling)

## Rule

The UI stays in sync with agent changes through Server-Sent Events. When the agent writes a file, the UI updates automatically — no polling, no manual refresh.

## Why

The agent modifies files on disk, but the UI runs in the browser. SSE bridges this gap: a file watcher on the server detects changes, streams them to the browser, and React Query invalidates the relevant caches. This is what makes the "files as database" pattern feel real-time.

## How It Works

1. **Server** watches the data directory with chokidar. The watcher is set up in a shared module (`server/lib/watcher.ts`) and the SSE endpoint is a file-based route:

   ```ts
   // server/lib/watcher.ts
   import { createFileWatcher } from "@agent-native/core";
   export const watcher = createFileWatcher("./data");
   ```

   ```ts
   // server/routes/api/events.get.ts
   import { createSSEHandler } from "@agent-native/core";
   import { watcher } from "../../lib/watcher.js";
   export default createSSEHandler(watcher);
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

## Performance

When the agent writes many files rapidly (e.g., during self-modification), each write fires a chokidar event → SSE broadcast → React Query invalidation. This can cause excessive refetching.

Mitigations:

- Use `staleTime: 2000` on React Query to debounce refetches
- Use path-based filtering (see Query Key Mapping) to limit which queries invalidate

## Troubleshooting

| Symptom                            | Check                                                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| UI not updating after agent writes | Is `useFileWatcher` called with the correct `queryClient`? Are the `queryKeys` matching your `useQuery` keys?   |
| SSE not firing                     | Open browser devtools → Network tab → filter by EventStream. Is `/_agent-native/events` connected? Is the server running? |
| Watcher not detecting changes      | Is the path correct? `createFileWatcher("./data")` is relative to CWD. Check the server's working directory.    |
| Constant reconnections             | Check for server crashes in terminal output.                                                                    |
| High CPU / event storms            | The agent is writing many files rapidly. Add `staleTime` to queries and use path-based filtering.               |

## Jitter Prevention

When the agent writes to application-state via script helpers (`writeAppState`, `deleteAppState`), the write is automatically tagged with `requestSource: "agent"`. This prevents the UI from overwriting active user edits when it receives the change event.

### How it works

1. **Agent writes** are tagged: the script helpers in `@agent-native/core/application-state` pass `{ requestSource: "agent" }` to the store.
2. **UI writes** are tagged: templates send a per-tab ID via the `X-Request-Source` header on PUT/DELETE requests to application-state endpoints.
3. **Polling filters**: `useFileWatcher()` accepts an `ignoreSource` option. The UI passes its own tab ID so it ignores events from its own writes — but still picks up events from agents, other tabs, and scripts.

### Template setup

```ts
// app/lib/tab-id.ts
export const TAB_ID = `tab-${Math.random().toString(36).slice(2, 8)}`;

// app/root.tsx
import { TAB_ID } from "@/lib/tab-id";

useFileWatcher({
  queryClient,
  queryKeys: ["app-state", "settings"],
  ignoreSource: TAB_ID,
});
```

The `use-navigation-state.ts` hook sends the same `TAB_ID` in the `X-Request-Source` header when writing navigation state, so the tab that wrote the state does not refetch it.

### Why this matters

Without jitter prevention, a cycle occurs: the UI writes state, polling detects the change, the UI refetches and re-renders, potentially overwriting what the user is actively editing. With `ignoreSource`, the UI only reacts to changes from other sources (agent scripts, other browser tabs, other users).

## Related Skills

- **storing-data** — Application-state and settings are the data stores that sync via polling
- **context-awareness** — Navigation state writes use jitter prevention to avoid overwriting active edits
- **scripts** — Script outputs written to the database trigger poll events
- **self-modifying-code** — Agent code edits trigger poll events; rapid edits can cause event storms
