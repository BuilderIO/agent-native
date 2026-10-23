---
"@agent-native/core": patch
---

Server tracking sends now time out after 10 seconds, the default of the PostHog, Segment and Amplitude Node SDKs. An analytics endpoint that stops answering no longer holds a connection per event for up to Node's 300-second limit.
