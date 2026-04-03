---
name: real-time-sync
description: >-
  How the UI stays in sync when the agent writes data. Use when wiring up
  query invalidation, debugging UI not updating, or understanding how SSE
  connects the agent to the browser.
---

# Real-Time Sync

## How It Works

When the agent writes data (via scripts or server handlers), the UI updates instantly. No polling, no manual refresh.

The flow:

1. **Agent writes** → `writeAppState("navigate", { view: "starred" })`
2. **Store emits SSE event** → `{ source: "app-state", type: "change", key: "navigate" }`
3. **Browser receives** → `useFileWatcher()` hook gets the event
4. **React Query invalidates** → relevant queries refetch, UI re-renders

This happens automatically for all writes through `@agent-native/core/application-state` and `@agent-native/core/settings`.

## SSE Events

| Source | Emitted by | Example |
|--------|-----------|---------|
| `"app-state"` | `writeAppState`, `deleteAppState` | `{ source: "app-state", type: "change", key: "navigation" }` |
| `"settings"` | `putSetting`, `deleteSetting` | `{ source: "settings", type: "change", key: "mail-settings" }` |

## Client Setup

Every template has an SSE endpoint and a `useFileWatcher` hook in `root.tsx`:

```ts
// server/routes/api/events.get.ts
import { createDefaultSSEHandler } from "@agent-native/core/server";
export default createDefaultSSEHandler();
```

```ts
// In root.tsx
useFileWatcher({
  queryClient: qc,
  queryKeys: [],
  onEvent: (data) => {
    if (data.source === "app-state") {
      // Invalidate queries affected by app state changes
      qc.invalidateQueries({ queryKey: ["compose-drafts"] });
    } else if (data.source === "settings") {
      qc.invalidateQueries({ queryKey: ["settings"] });
    }
  },
});
```

Use the `key` field to selectively invalidate — don't invalidate everything on every event.

## For Custom Domain Data

If your template has Drizzle tables and you want SSE notifications after writes, emit from your handler:

```ts
import { getAppStateEmitter } from "@agent-native/core/application-state";

// After inserting a booking:
getAppStateEmitter().emit("app-state", {
  source: "app-state",
  type: "change",
  key: "bookings-updated",
});
```

## Troubleshooting

| Symptom | Check |
|---------|-------|
| UI not updating after script writes | Is the script using `writeAppState`/`writeSetting`? Direct SQL writes don't emit SSE. |
| SSE not connected | Browser devtools → Network → EventStream. Is `/_agent-native/events` connected? |
| Wrong queries invalidating | Check the `onEvent` callback — filter by `data.source` and `data.key` |
