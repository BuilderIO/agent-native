---
"@agent-native/core": patch
---

Stamp `$ai_generation` and `$ai_span` events at the moment the operation ended, which is the convention PostHog reads them by. Its timeline derives an operation's start as `timestamp - $ai_latency`, so stamping the start drew every bar one full latency too early: model calls overlapped each other by a growing margin, a call's tool spans appeared underneath the _next_ call, and a 35s run rendered as 31.2s. The start is still readable directly as `created_at` / `created_at_ms`.
