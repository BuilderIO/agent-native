---
"@agent-native/core": patch
---

Harden Agent Teams serverless dispatch and visibility: quick non-2xx
self-dispatch responses now fail the sub-agent instead of leaving a ghost
running task, and background transcripts/stop controls resolve the active
chunked run id.
