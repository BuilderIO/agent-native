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

2. **Client** polls for changes and updates per-source counters:

   ```ts
   import { useDbSync } from "@agent-native/core";
   useDbSync({ queryClient });
   ```

3. **Templates fold a per-source counter into the relevant query key.** When the source advances, only the dependent query refetches:

   ```ts
   import { useChangeVersion } from "@agent-native/core/client";

   const v = useChangeVersion("items"); // or "settings", "dashboards", "action", etc.
   const { data } = useQuery({
     queryKey: ["items", v],
     queryFn: fetchItems,
     placeholderData: (prev) => prev,
   });
   ```

4. When the agent writes to the database, the server emits a `recordChange({ source, ... })` event. `useDbSync` bumps the matching counter; any query with that counter in its key refetches; everything else stays untouched.

## Don't

- Don't create manual polling loops — `useDbSync()` handles it (polls every 2 seconds by default)
- Don't create your own fetch-based polling alongside `useDbSync` — use the `onEvent` callback for custom handling

## Tuning refetch behavior

`useDbSync` invalidates every active query on any non-own change event. The `onEvent` callback still fires with each change event, so templates can layer surgical extras on top — for example, invalidating an inactive query that wouldn't otherwise refetch:

```ts
useDbSync({
  queryClient,
  onEvent: (data) => {
    if (data.source === "settings") {
      // Force a refetch even when not actively observed
      queryClient.invalidateQueries({
        queryKey: ["settings"],
        refetchType: "all",
      });
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

| Symptom                            | Check                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| UI not updating after agent writes | Is `useDbSync` called with the correct `queryClient`? Does the affected query have an active observer?  |
| Poll endpoint not responding       | Is `/_agent-native/poll` accessible? Is the server running?                                              |
| High CPU / event storms            | The agent is writing rapidly. Add `staleTime` to queries to debounce refetches.                          |

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
