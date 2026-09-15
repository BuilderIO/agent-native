---
"@agent-native/core": patch
---

Stop the session replay recorder from retry-storming an over-quota analytics
ingest key. A 429 now parks uploads for the window the server names in
`Retry-After` and ends the recording when that window outlasts the session,
instead of re-sending the rejected batch on every flush tick while the live
event queue grows unbounded.
