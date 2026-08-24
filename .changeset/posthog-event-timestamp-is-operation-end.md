---
"@agent-native/core": patch
---

Send `$ai_generation` and `$ai_span` to PostHog stamped at the moment the operation ended, which is the convention it reads them by: its timeline derives an operation's start as `timestamp - $ai_latency`, so stamping the start drew every bar one full latency too early — model calls overlapped each other by a growing margin, a call's tool spans appeared underneath the *next* call, and a 35s run rendered as 31.2s. The shift is applied inside the PostHog provider, so the shared event keeps the operation's start for Mixpanel, Amplitude, webhooks, and Agent Native Analytics, which read the timestamp verbatim. Events with no `$ai_latency` — a trace, an exception — are unshifted.
