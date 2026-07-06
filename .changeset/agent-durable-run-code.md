---
"@agent-native/core": minor
---

Add durable background executions to the sandboxed `run-code` tool so long compute survives the hosted serverless run ceiling: pass `background: true` (or set `AGENT_NATIVE_SANDBOX=background`) and the code is enqueued to a new additive, Postgres/SQLite-portable `sandbox_executions` table and executed out-of-band with a generous budget — self-dispatched to the new HMAC-verified `/_agent-native/sandbox/_process-execution` route on serverless, in-process on long-lived Node — with atomic single-claimer leasing, heartbeats, lease-expiry retries, owner-scoped status polling via `run-code {executionId}` (plus an exported `createGetCodeExecutionEntry` tool factory), opportunistic poll-time re-drives, and a warm-instance sweep so lost dispatches and dead executors are recovered instead of hanging; foreground `run-code` behavior is unchanged and the executor reuses the existing local sandbox adapter, bridge, and env-scrub machinery.
