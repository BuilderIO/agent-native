---
"@agent-native/core": patch
---

Forward Builder gateway heartbeat JSONL frames through the engine and agent SSE stream so long upstream silences (adaptive thinking, TTFT) do not trip the client no-progress timeout.
