---
"@agent-native/core": patch
---

Fix presence local-echo re-renders and coalesce pinch-zoom updates through requestAnimationFrame. `usePresence` no longer re-derives and re-renders subscribers when an awareness "change" event only reflects the local client's own state (e.g. cursor/selection echoes), and `usePinchZoom` now batches wheel and touch pinch zoom updates to at most one state update per animation frame instead of one per input event.
