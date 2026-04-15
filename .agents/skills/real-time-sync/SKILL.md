---
name: real-time-sync
description: >-
  How to keep the UI in sync with agent changes via polling. Use when wiring
  query invalidation for new data models, debugging UI not updating, or
  understanding jitter prevention.
---

# Real-Time Sync (Polling)

## Rule

The UI stays in sync with agent/script changes through database polling. When the agent writes to the database, the UI detects the change and updates automatically — no manual refresh needed.

## Why

The agent modifies data in SQL, but the UI runs in the browser. Polling bridges this gap: every database write increments a version counter, the `useDbSync()` hook polls for version changes, and React Query invalidates the relevant caches. This is what makes database writes feel real-time.

## How It Works

1. **Server** increments a version counter on every database write. The `/_agent-native/poll` endpoint returns the current version and any events since the last poll.

2. **Client** polls for changes and invalidates React Query caches:

   ```ts
   import { useDbSync } from "@agent-native/core";
   useDbSync({ queryClient, queryKeys: ["items", "settings"] });
   ```

3. When the agent writes to the database, the version increments, polling detects it, and React Query refetches the affected queries.

## Don't

- Don't create manual polling loops — `useDbSync()` handles it (polls every 2 seconds by default)
- Don't create your own fetch-based polling alongside `useDbSync` — use the `onEvent` callback for custom handling

## Query Key Mapping

By default, `useDbSync` invalidates all listed query keys on every change. For apps with multiple data models, this causes unnecessary refetches. Use event-based filtering via the `onEvent` callback:

```ts
useDbSync({
  queryClient,
  queryKeys: [], // don't auto-invalidate everything
  onEvent: (data) => {
    if (data.source === "settings") {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    } else if (data.source === "app-state") {
      queryClient.invalidateQueries({ queryKey: ["navigate-command"] });
    } else {
      queryClient.invalidateQueries({ queryKey: ["items"] });
    }
  },
});
```

To prevent cache thrashing during rapid agent writes, set `staleTime` on your queries:

```ts
useQuery({
  queryKey: ["items"],
  queryFn: fetchItems,
  staleTime: 2000, // don't refetch within 2 seconds
});
```

## Troubleshooting

| Symptom                            | Check                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| UI not updating after agent writes | Is `useDbSync` called with the correct `queryClient`? Are the `queryKeys` matching your `useQuery` keys?       |
| Poll endpoint not responding       | Is `/_agent-native/poll` accessible? Is the server running?                                                    |
| High CPU / event storms            | The agent is writing rapidly. Add `staleTime` to queries and use event-based filtering.                        |

## Jitter Prevention

When the agent writes to application-state via script helpers (`writeAppState`, `deleteAppState`), the write is automatically tagged with `requestSource: "agent"`. This prevents the UI from overwriting active user edits when it receives the change event.

### How it works

1. **Agent writes** are tagged: the script helpers in `@agent-native/core/application-state` pass `{ requestSource: "agent" }` to the store.
2. **UI writes** are tagged: templates send a per-tab ID via the `X-Request-Source` header on PUT/DELETE requests to application-state endpoints.
3. **Polling filters**: `useDbSync()` accepts an `ignoreSource` option. The UI passes its own tab ID so it ignores events from its own writes — but still picks up events from agents, other tabs, and scripts.

### Template setup

```ts
// app/lib/tab-id.ts
export const TAB_ID = `tab-${Math.random().toString(36).slice(2, 8)}`;

// app/root.tsx
import { TAB_ID } from "@/lib/tab-id";

useDbSync({
  queryClient,
  queryKeys: ["app-state", "settings"],
  ignoreSource: TAB_ID,
});
```

The `use-navigation-state.ts` hook sends the same `TAB_ID` in the `X-Request-Source` header when writing navigation state, so the tab that wrote the state does not refetch it.

### Why this matters

Without jitter prevention, a cycle occurs: the UI writes state, polling detects the change, the UI refetches and re-renders, potentially overwriting what the user is actively editing. With `ignoreSource`, the UI only reacts to changes from other sources (agent scripts, other browser tabs, other users).

## Action Routes and Polling

Action routes (`/_agent-native/actions/:name`) work with the same polling system. When a POST/PUT/DELETE action writes to the database, the version counter increments and `useDbSync` picks up the change. Frontend mutations via `useActionMutation` automatically invalidate `["action"]` query keys on success, triggering refetches of `useActionQuery` hooks.

### Auto-emit on mutating actions

The framework emits a poll event with `source: "action"` whenever any non-read-only action runs to completion — whether called via HTTP (`/_agent-native/actions/:name`) or as an agent tool call. Read-only actions (`http: { method: "GET" }` or explicit `readOnly: true`) are skipped.

This means UIs don't need the agent to remember to call `refresh-screen` after every mutation. A listener like this (used in the `macros` template) will refresh after any mutating agent call:

```ts
useDbSync({
  queryClient,
  queryKeys: [],
  ignoreSource: TAB_ID,
  onEvent: (data) => {
    if (data.requestSource === TAB_ID) return;
    // Invalidate all useActionQuery caches so list-*, get-*, etc. refetch
    queryClient.invalidateQueries({ queryKey: ["action"] });
  },
});
```

`refresh-screen` remains available for unusual cases — e.g. the agent mutated data via a path the framework can't see (external system the app mirrors), or the agent wants to pass a `scope` hint for narrower invalidation.

## Related Skills

- **storing-data** — Application-state and settings are the data stores that sync via polling
- **context-awareness** — Navigation state writes use jitter prevention to avoid overwriting active edits
- **actions** — Action routes auto-expose actions as HTTP endpoints; database writes trigger poll events
- **self-modifying-code** — Agent code edits trigger poll events; rapid edits can cause event storms
