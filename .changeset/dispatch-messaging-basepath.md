---
"@agent-native/dispatch": patch
---

Fix Messaging enable/disable and webhook setup fetches to use `agentNativePath()`, so they work under a base-path (workspace) mount instead of 404ing at the gateway root.
