---
"@agent-native/dispatch": patch
---

Report the embedded workspace app to the Dispatch agent as structured context. `/apps/<id>` now resolves to a `workspace-app` navigation view that keeps the app id and in-app path instead of collapsing to the apps list, and `view-screen` emits an `embeddedApp` block for both that route and chat-first mode, where the route stays on `/chat` and the open app is named only by `chat-first-pane` state. An app that is open but cannot be identified reports `status: "unknown"` rather than a default or an omitted field.
