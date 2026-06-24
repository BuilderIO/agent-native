---
"@agent-native/core": minor
"@agent-native/dispatch": patch
---

Add a framework audit log: a durable, complete, access-scoped, append-only record of who mutated what app data, when, from where, and — when it was the agent — in which run. Capture is automatic at the `defineAction` seam (default-on for mutating actions; read-only actions opt in via `audit.onRead`), with credential redaction, agent-vs-human actor attribution, and agent thread/turn linkage. Reads go through two new core actions every app inherits — `list-audit-events` and `get-audit-event` — scoped in SQL to the caller's identity and org. Stored in `agent_audit_log` (provider-agnostic), with a retention purge configurable via `AGENT_NATIVE_AUDIT_RETENTION_DAYS` (default 365) and a global kill switch `AGENT_NATIVE_AUDIT_ENABLED=false`. Distinct from observability (sampled telemetry) and tracking (fire-and-forget analytics).
