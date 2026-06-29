---
"@agent-native/core": patch
---

Add an `onReady` callback to `EmbeddedExtension` that fires once when the embedded iframe first signals content readiness (its first height report, or iframe load as a fallback). Hosts that gate on content paint — such as dashboard report screenshots — can use it to avoid capturing a blank extension before its iframe has rendered.
