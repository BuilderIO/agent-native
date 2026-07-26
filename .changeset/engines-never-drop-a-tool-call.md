---
"@agent-native/core": patch
---

Engine adapters no longer drop a tool call whose arguments were split across
stream deltas. Every adapter now accumulates the streamed argument JSON and
reconciles it against what the turn actually delivered: a call assembled from
its deltas is executed normally, and one whose stream was cut mid-arguments
becomes an in-band tool-call error the model reads and retries from, instead of
ending the turn advertising an action that never ran ("The agent stopped before
starting the X action").
