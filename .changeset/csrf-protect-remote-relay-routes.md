---
"@agent-native/core": patch
---

Keep the session-authenticated remote-device relay routes under CSRF protection.
The `/integrations/` CSRF exemption exists for HMAC-verified webhooks, but
prefix matching extended it to `/integrations/remote/*`, where
`register`, `enqueue`, and `computer/{approvals,commands}` authenticate on the
`SameSite=None` session cookie. A cross-site simple-request POST could
therefore create and self-approve a browser-control operation — click, type, or
navigate on the victim's paired Chrome — without any first-party marker or
human approval step. Those routes are now excluded from the exemption; the
device's own bearer-token calls (`poll`, `result`, `heartbeat`) are unaffected.
