---
"@agent-native/core": patch
---

Fix presence local-echo re-renders and coalesce pinch-zoom updates through requestAnimationFrame. `usePresence` no longer re-derives and re-renders subscribers when an awareness "change" event only reflects the local client's own state (e.g. cursor/selection echoes), and `usePinchZoom` now batches wheel and touch pinch zoom updates to at most one state update per animation frame instead of one per input event. When multiple wheel events land in the same animation frame, the cursor-anchored scroll compensation now accumulates across all of them (matching the pre-batching, one-event-at-a-time result) instead of anchoring later events in the burst against the stale pre-burst scroll position.
