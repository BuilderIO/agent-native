---
"@agent-native/dispatch": patch
---

Dispatch now prefers the workspace app that owns a domain over a connected third-party tool for the same domain, sends requests to create or draft something to the owning app's agent so the item opens beside the chat as an unsaved draft, and opens its own screens with navigate before summarizing them.
