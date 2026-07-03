---
name: real-time-sync
description: >-
  How to keep the UI in sync with agent changes via SSE plus polling fallback.
  Use when wiring query invalidation for new data models, debugging UI not
  updating, or understanding jitter prevention.
scope: dev
metadata:
  internal: true
---

# Real-Time Sync

## Rule

The UI stays in sync with agent/script changes through `useDbSync()`. In-process writes stream over `/_agent-native/events` first; `/_agent-native/poll` remains the cross-process/serverless fallback. When the agent writes to the database, the UI detects the change and updates automatically — no manual refresh needed.

## Why

The agent modifies data in SQL, but the UI runs in the browser. SSE bridges same-process writes immediately; polling bridges anything SSE cannot see, such as another serverless invocation, cron job, or external script. Every visible write increments a version counter, `useDbSync()` receives the change, and React Query invalidates the relevant caches. This is what makes database writes feel real-time without relying on aggressive polling.

## How It Works

1. **Server** increments a version counter on every database write. In-process events stream through the authenticated `/_agent-native/events` endpoint.

2. **Client** listens for sync events and updates per-source change counters:

   ```ts
   import { useDbSync } from "@agent-native/core/client";
   useDbSync({ queryClient });
   ```

   For each non-own event, `useDbSync` bumps a per-source counter (e.g. `dashboards`, `analyses`, `settings`, `action`) and invalidates a small fixed list of framework-internal prefixes (`["action"]`, `["app-state"]`, `["__set_url__"]`, etc.). It does **not** blanket-invalidate templates' own data queries for ordinary domain events — that caused a request storm in production. The exception is `source: "action"`: a successful mutating action is the framework-wide "agent changed app data" signal, so `useDbSync` also refreshes active React Query observers as a compatibility safety net for custom apps that have not yet moved every read to `useActionQuery` or source-versioned query keys.

3. **Templates fold per-source counters into their query keys.** This is the pattern that makes "agent writes show up without a manual refresh" reliable:

   ```ts
   import { useChangeVersion } from "@agent-native/core/client";
   import { useQuery } from "@tanstack/react-query";

   const v = useChangeVersion("dashboards");
   const dashboard = useQuery({
     queryKey: ["dashboard", id, v],
     queryFn: () => fetchDashboard(id),
     placeholderData: (prev) => prev, // no flicker on refetch
   });
   ```

   When the agent writes (`update-dashboard` action → server emits `source: "dashboards"`), the counter advances, the queryKey changes, and React Query refetches that one query. The old data stays on screen during the refetch thanks to `placeholderData`.

   For list/sidebar queries, use the same pattern — pass the counter into the queryKey of every list query you want to keep fresh.

4. **Fallback** polling calls `/_agent-native/poll?since=N`. It runs every 2 seconds until SSE is connected, then relaxes to 15 seconds (`SSE_FALLBACK_INTERVAL_MS`). If SSE is disabled or unavailable (e.g., edge/serverless deployments), polling continues at the 2 s cadence. Polling is the universal serverless fallback — it detects DB timestamp changes even when the write happened in a different process or invocation.

5. When the agent writes to the database, the version increments, SSE/polling detects it, and React Query refetches the affected queries.

## Don't

- Don't create manual polling loops — `useDbSync()` handles SSE plus fallback polling
- Don't create your own fetch-based polling alongside `useDbSync` — use the `onEvent` callback for custom handling
- Don't open your own `EventSource` to `/_agent-native/events`. A tab must hold exactly ONE SSE connection no matter how many features listen — extra streams eat the browser's per-origin connection budget and can starve ordinary data fetches (worst on HTTP/1.1 dev servers). Subscribe to the shared transport instead:

  ```ts
  import { subscribeSyncEvents } from "@agent-native/core/client";

  const unsubscribe = subscribeSyncEvents({
    onEvents: (events) => {
      // filter by event.source and handle push-style updates
    },
    // Optional: relax your own fallback cadence while push is healthy.
    onSseStateChange: (connected) => {},
  });
  ```

  `useDbSync` and every `subscribeSyncEvents` subscriber share one `EventSource` and one fallback poll loop per tab — this is how collaborative documents receive doc updates and cursor/awareness events.

## Which sources to depend on

Common sources you'll fold into query keys:

| Source            | Bumped by                                                                   |
| ----------------- | --------------------------------------------------------------------------- |
| `action`          | The agent runner after every successful mutating action tool call           |
| `app-state`       | Writes to `application_state` (navigation, selections, ephemeral UI state)  |
| `settings`        | Writes to the `settings` table                                              |
| `dashboards`      | Dashboard CRUD via `upsertDashboard` / `archiveDashboard` etc.              |
| `analyses`        | Analysis CRUD                                                               |
| `extensions`      | Extension CRUD                                                              |
| `collab`          | Yjs collaborative-doc updates                                               |
| `screen-refresh`  | Explicit `refresh-screen` agent tool call                                   |

If a query reads data the agent can mutate via more than one path, depend on multiple sources with `useChangeVersions`:

```ts
const v = useChangeVersions(["dashboards", "action"]);
useQuery({ queryKey: ["dashboard", id, v], ... });
```

`useChangeVersions` returns a single integer that advances whenever any of the listed sources advance.

## Tuning refetch behavior

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
| UI not updating after agent writes | Is `useDbSync` called with the correct `queryClient`? Does the affected query have an active observer?         |
| Poll endpoint not responding       | Is `/_agent-native/poll` accessible? Is the server running?                                                    |
| SSE not connecting                 | Is `/_agent-native/events` accessible and authenticated? Polling should still keep the UI fresh as fallback.   |
| High CPU / event storms            | The agent is writing rapidly. Add `staleTime` to queries to debounce refetches.                                |

## Jitter Prevention

When the agent writes to application-state via script helpers (`writeAppState`, `deleteAppState`), the write is automatically tagged with `requestSource: "agent"`. This prevents the UI from overwriting active user edits when it receives the change event.

### How it works

1. **Agent writes** are tagged: the script helpers in `@agent-native/core/application-state` pass `{ requestSource: "agent" }` to the store.
2. **UI writes** are tagged: templates send a per-tab ID via the `X-Request-Source` header on PUT/DELETE requests to application-state endpoints.
3. **Sync filters**: `useDbSync()` accepts an `ignoreSource` option. The UI passes its own tab ID so it ignores events from its own writes — but still picks up events from agents, other tabs, and scripts.

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

Without jitter prevention, a cycle occurs: the UI writes state, sync detects the change, the UI refetches and re-renders, potentially overwriting what the user is actively editing. With `ignoreSource`, the UI only reacts to changes from other sources (agent scripts, other browser tabs, other users).

## Action Routes and Live Sync

Actions work with the same sync system. When a mutating action writes to the database, the version counter increments and `useDbSync` picks up the change. Frontend mutations via `useActionMutation` automatically invalidate `["action"]` query keys on success, triggering refetches of `useActionQuery` hooks. Client components should call actions through those hooks, not with raw action-route fetches.

For custom apps, the best out-of-the-box path is:

1. Put read actions in `actions/` with `defineAction({ http: { method: "GET" } })`.
2. Put write actions in `actions/` with the default POST/PUT/DELETE behavior.
3. Call reads from React with `useActionQuery` and writes with `useActionMutation`.

This avoids duplicate `/api/*` JSON CRUD routes and makes agent-created records show up automatically. Raw `useQuery` can still work, but it should include `useChangeVersions(["action", "<domain-source>"])` in the query key for targeted refreshes.

### Auto-emit on mutating actions

The framework emits a change event with `source: "action"` whenever any non-read-only action runs to completion — whether called via HTTP (`/_agent-native/actions/:name`) or as an agent tool call. Read-only actions (`http: { method: "GET" }` or explicit `readOnly: true`) are skipped.

This means UIs don't need the agent to remember to call `refresh-screen` after every mutation. A listener like this (used in the `macros` template) will refresh after any mutating agent call:

```ts
useDbSync({
  queryClient,
  ignoreSource: TAB_ID,
  onEvent: (data) => {
    if (data.requestSource === TAB_ID) return;
    // Invalidate all useActionQuery caches so list-*, get-*, etc. refetch
    queryClient.invalidateQueries({ queryKey: ["action"] });
  },
});
```

`refresh-screen` remains available for unusual cases — e.g. the agent mutated data via a path the framework can't see (external system the app mirrors), or the agent wants to pass a `scope` hint for narrower invalidation.

## Keeping Stateful Components In Sync

The `useChangeVersion` / `useActionQuery` pattern above keeps the **query layer** fresh. But components that copy a server value into local React state still go stale on agent edits — refetching the query updates the prop, yet the local copy never re-adopts it. This is a recurring bug.

**Never do this** for a value the agent can mutate:

```ts
// BUG: `title` is captured once and never re-reads the prop.
const [title, setTitle] = useState(props.title);
```

When the agent renames the record, the query refetches, `props.title` updates, but the input still shows the stale value until the component remounts.

**Derived-state surfaces (form fields, inline editors, popovers): use `useReconciledState`.** It re-adopts the authoritative external value when it changes, except while the user is actively editing that field — so agent mutations show up live without clobbering in-progress typing:

```ts
import { useReconciledState } from "@agent-native/core/client";

// `active` = true while the user is editing this field (focused / dirty).
const [title, setTitle] = useReconciledState(props.title, { active: isEditing });
```

**Collaborative rich-text editors are different** — they don't copy a value into `useState`. They reconcile authoritative SQL content into a shared Y.Doc under an `updatedAt` gate with lead-client election. See `real-time-collab` → "Agent edits as a real-time peer editor". Don't reach for `useReconciledState` for a Yjs-backed editor.

| Surface | Keep it fresh with |
| ------- | ------------------ |
| React Query reads | `useChangeVersion` / `useActionQuery` (above) |
| Local edit state copied from a server value (inputs, popovers, inline editors) | `useReconciledState(externalValue, { active })` |
| Collaborative rich-text editor (Yjs) | `updatedAt`-gated reconcile + `isReconcileLeadClient` — see `real-time-collab` |

## Granular server-side merge for non-body fields

For structured documents (slide decks, form builders, design files) where the
Yjs body collab would cause LWW conflicts at the container level, pair the
change-sync `updatedAt` bump with a **granular server-side merge action** that
accepts targeted per-item operations (add/patch/delete/reorder). Concurrent
edits to different items both survive at the action level; the `collab` source
version bump then propagates the merged state to all open clients. See
`real-time-collab` for the pattern and examples.

## Related Skills

- **storing-data** — Application-state and settings are data stores that sync through change events
- **context-awareness** — Navigation state writes use jitter prevention to avoid overwriting active edits
- **actions** — Mutating actions trigger change events
- **client-methods** — Route details belong in helpers/hooks, not components
- **self-modifying-code** — Agent code edits trigger change events; rapid edits can cause event storms
- **real-time-collab** — Collaborative editors reconcile agent edits into a shared Y.Doc, driven by the same change-sync `updatedAt` bump; also the granular server-side merge pattern for structured data
