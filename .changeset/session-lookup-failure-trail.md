---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

A failed session lookup now answers a retryable 503 (`session_unavailable`) instead of the 401 a signed-out visitor gets, and is reported once with its real cause and the request id. The failed-request packet now carries the request id of the request it ran in. Dispatch's "Couldn't load data" card shows that id, and a workspace gateway read that fails now logs its cause, the gateway's own request id and elapsed time, and a gateway that does not answer in time reports `workspace_gateway_timeout` instead of `workspace_gateway_unavailable`.
