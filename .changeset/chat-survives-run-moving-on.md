---
"@agent-native/core": patch
"@agent-native/agentkit": patch
---

Keep a chat alive when it reconnects after its run moved on: the client and event stream now skip events from a run other than the subscribed one, and reconnecting from a sequence the server already pruned resumes from the earliest retained event instead of failing with `run_stream_failed`.
