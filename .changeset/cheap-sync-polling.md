---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Make framework polling cheaper with durable sync events, remove Dispatch's short app-list polling intervals, preview large DB admin cells by default to avoid accidental blob transfers, and require configured file storage for binary resource uploads instead of storing base64 blobs in SQL.
