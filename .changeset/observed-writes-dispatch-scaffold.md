---
"@agent-native/dispatch": patch
---

Creating a workspace app now tells the framework when it starts the scaffold command or deletes a half-created app folder, so a failed create-app call that already touched disk stops the agent run instead of being retried as if nothing was saved.
