---
"@agent-native/dispatch": patch
---

Fix workspace app embed session mint returning a 500 for apps whose discovered agent URL is a deep link (e.g. Clips share links). The target MCP connection and A2A audience now resolve through the app's home origin instead of the raw discovered URL.
