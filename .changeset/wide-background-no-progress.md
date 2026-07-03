---
"@agent-native/core": patch
---

Allow durable background agent runs to wait longer between real progress events before checkpointing, so large hosted tool generations can use the background-function budget instead of retrying every few minutes.
