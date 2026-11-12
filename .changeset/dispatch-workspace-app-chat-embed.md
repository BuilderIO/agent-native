---
"@agent-native/dispatch": patch
---

Fix the app chat rail on `/dispatch/apps/<appId>` for mounted workspace apps. Dispatch now always declares inline MCP App support when it asks an app for an embed session, so apps no longer hide `create_embed_session` from it. When an app's chat still can't connect, its chat button now focuses the rail's Retry button instead of doing nothing.
