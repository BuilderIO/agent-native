---
"@agent-native/core": patch
---

Emit `invite_sent` and `invite_accepted` tracking events for the org invite lifecycle, so referral/virality reporting can see team growth. Register the telemetry with the request's `waitUntil` (or a bounded wait when no request is reachable) so a serverless runtime can't freeze the function before the event ships.
