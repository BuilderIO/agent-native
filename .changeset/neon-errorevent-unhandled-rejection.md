---
"@agent-native/core": patch
---

Stop Neon WebSocket drops from surfacing as unhandled `[object ErrorEvent]` promise rejections. Fire-and-forget DB writes (agent-team run heartbeats and progress saves, desktop-exchange cleanup) now catch and log connection failures with context via a new `describeDbError` helper — which also makes the Neon pool/client error logger print the ErrorEvent's actual message instead of `[object ErrorEvent]`. The server Sentry filter now recognizes bundled SDK chunks (e.g. `/var/task/_libs/@sentry/...`) as non-application frames so SDK-only rejection stacks from serverless bundles are dropped as intended.
