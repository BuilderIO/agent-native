---
"@agent-native/core": patch
---

Stop background polling and event streams in app surfaces an embedding host has hidden. An Electron `<webview>` guest keeps reporting `document.visibilityState === "visible"` while its element is `display: none`, so every visibility-based pause in the client was inert inside the desktop shell and each backgrounded app tab kept polling at its foreground cadence and holding its event stream open. Hosts can now declare visibility explicitly with `buildSurfaceVisibilityScript`, and `useDbSync` treats a host-hidden surface as paused regardless of `pauseWhenHidden`.
