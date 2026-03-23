---
name: sse-db-sync
description: >-
  How to keep the UI in sync with database changes via Server-Sent Events. Use
  when wiring query invalidation for new data, debugging UI not updating after
  agent writes, or understanding the real-time sync architecture.
---

# SSE Database Sync

## Rule

The UI stays in sync with agent changes through Server-Sent Events. When the agent writes to the database, the UI updates automatically — no polling, no manual refresh.

## Why

The agent modifies data via scripts (which write to SQL), but the UI runs in the browser. SSE bridges this gap: database writes emit events via EventEmitter, the SSE handler streams them to the browser, and React Query invalidates the relevant caches.

## How It Works

1. **Database writes emit events** — The core stores (application-state, settings) automatically emit SSE events on every write:

   ```ts
   // This happens automatically inside appStatePut / putSetting
   emitter.emit("app-state", { source: "app-state", type: "change", key: "navigation" });
   emitter.emit("settings", { source: "settings", type: "change", key: "mail-settings" });
   ```

2. **SSE handler streams to clients** — `createDefaultSSEHandler()` subscribes to all emitters and pushes events to connected browsers:

   ```ts
   // In templates — server/routes/api/events.get.ts
   import { createDefaultSSEHandler } from "@agent-native/core/server";
   export default createDefaultSSEHandler();
   ```

3. **Client invalidates caches** — `useFileWatcher()` receives SSE events and invalidates React Query:

   ```ts
   useFileWatcher({
     queryClient: qc,
     queryKeys: [],
     onEvent: (data) => {
       if (data.source === "app-state") {
         if (data.key?.startsWith("compose-")) {
           qc.invalidateQueries({ queryKey: ["compose-drafts"] });
         }
         qc.invalidateQueries({ queryKey: ["navigate-command"] });
       } else if (data.source === "settings") {
         qc.invalidateQueries({ queryKey: ["settings"] });
       }
     },
   });
   ```

## SSE Event Shape

```ts
// Application state changes
{ source: "app-state", type: "change" | "delete", key: "navigation" }

// Settings changes
{ source: "settings", type: "change" | "delete", key: "mail-settings" }
```

## Don't

- Don't poll for changes — SSE handles it
- Don't create your own EventSource connections alongside `useFileWatcher` — use the `onEvent` callback
- Don't use file watchers for data sync — all data is SQL-backed now

## For Domain Data (Drizzle tables)

If your template has custom Drizzle tables and you need SSE notifications when they change, emit events from your handlers:

```ts
import { getAppStateEmitter } from "@agent-native/core/application-state";

// After a DB write in your handler:
getAppStateEmitter().emit("app-state", {
  source: "app-state",
  type: "change",
  key: "domain-data-updated",
});
```

Or use the settings emitter for config-like data:

```ts
import { getSettingsEmitter } from "@agent-native/core/settings";

getSettingsEmitter().emit("settings", {
  source: "settings",
  type: "change",
  key: "my-config",
});
```

## Troubleshooting

| Symptom | Check |
|---------|-------|
| UI not updating after agent writes | Is `useFileWatcher` called with the correct `queryClient`? Is the `onEvent` callback handling the right `source`? |
| SSE not firing | Open browser devtools → Network → filter EventStream. Is `/api/events` connected? |
| Missing events after DB write | Are you using core store helpers (`putSetting`, `appStatePut`)? Direct SQL writes don't emit SSE events. |
