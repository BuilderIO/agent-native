---
"@agent-native/core": patch
---

Fail closed when an `ai-sdk:*` engine has no provider key, instead of sending an
unauthenticated request. The provider factory was previously built with no
`apiKey`, so the SDK omitted the Authorization header and the gateway's 401 came
back as `http_401` "Missing Authentication header" — a transport error naming the
wrong cause, which a scheduled job then retried on every tick forever. It now
reports `missing_credentials` and names the env var it wants, matching what
`builder-engine` and `anthropic-engine` already did.

Also stop reaping in-process background automations (scheduler and trigger runs)
at the tight 45s post-claim stale window. That window exists to reach a durable
successor sooner, but these runs carry no `dispatch_payload` and have no
successor to reach, so an early reap killed still-working jobs that nothing could
recover. They now get the 90s background window, and the recovery path reports
`not_redispatchable` rather than `payload_missing`, which read as data loss for
the one case where nothing was ever lost.
