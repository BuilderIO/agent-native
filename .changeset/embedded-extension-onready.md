---
"@agent-native/core": patch
---

Add `onReady` and `onUnavailable` callbacks to `EmbeddedExtension`. `onReady` fires once when the embedded iframe first signals content readiness (its first height report, or iframe load as a fallback) — hosts that gate on content paint, such as dashboard report screenshots, can use it to avoid capturing a blank extension. `onUnavailable` fires when the extension can't be loaded for the current viewer (e.g. 403/404 because it isn't shared with them or no longer exists), so hosts can render an explanatory fallback instead of a silently blank panel.
