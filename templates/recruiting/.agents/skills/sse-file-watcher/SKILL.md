---
name: real-time-sync
description: >-
  How the UI stays in sync when the agent writes data. Use when wiring up
  query invalidation, debugging UI not updating, or understanding how SSE
  connects the agent to the browser.
---

# Real-Time Sync

## How It Works

When the agent writes data (via scripts or server handlers), the UI updates automatically via polling/SSE.

The flow:

1. **Agent writes** → `writeAppState("navigate", { view: "candidates" })`
2. **Store emits SSE event** → `{ source: "app-state", type: "change", key: "navigate" }`
3. **Browser receives** → `useFileWatcher()` hook gets the event
4. **React Query invalidates** → relevant queries refetch, UI re-renders

## Troubleshooting

| Symptom | Check |
|---------|-------|
| UI not updating after script writes | Is the script using `writeAppState`/`writeSetting`? Direct SQL writes don't emit SSE. |
| SSE not connected | Browser devtools → Network → EventStream. Is `/api/events` connected? |
