---
"@agent-native/core": patch
---

Durable background diagnostics: preserve the background-function worker's last
`diag_stage` (`route_entered` / `auth_failed` / etc., or `none` if it never
reached the route) in the foreground circuit-breaker's
`foreground_inline_recovery` detail instead of overwriting it. This makes a
silent worker death diagnosable from `/runs/active` without reading the
unreadable Netlify background-function logs. `readBackgroundRunClaim` now also
returns `diagStage`.
