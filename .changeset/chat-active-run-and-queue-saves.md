---
"@agent-native/core": patch
---

Report a finished chat run as no longer active while keeping it available for replay, keep a queued follow-up's promotion claim when a thread save lands at the same time so the follow-up is answered, and stop a stale mid-stream save from adding a duplicate reply to the stored thread.
