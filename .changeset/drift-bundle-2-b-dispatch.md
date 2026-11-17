---
"@agent-native/dispatch": patch
---

Add the MCP-only `route-app-intent` action, which picks the granted app that should be on screen for a chat request using Decisions. `open_app` now waits at most 15s for a target's embed session and stops the target request when it gives up.
