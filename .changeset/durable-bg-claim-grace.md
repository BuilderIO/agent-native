---
"@agent-native/core": patch
---

Durable background agent-chat: raise the foreground circuit-breaker's claim grace
from 8s to 15s (`BACKGROUND_CLAIM_GRACE_MS`). Heavy apps (observed on analytics
in prod) take longer than 8s to cold-start the background function and reach
`claimBackgroundRun`, so the foreground recovered inline every time — adding ~8s
latency per turn and never using the 15-minute background budget. 15s lets the
slow-but-alive workers win the claim while staying well within the foreground's
~40s soft-timeout; a genuinely dead worker still falls back to inline.
