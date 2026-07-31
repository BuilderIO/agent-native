---
"@agent-native/core": patch
---

Record tool arguments and result summaries in delegated-run traces. The A2A
agent-activity snapshot and the agent-team / harness background transcripts now
carry each tool call's arguments and a result preview in redacted, size-capped
form, so a delegated run that loops on the same tool is diagnosable from what
was recorded instead of needing a fresh repro. Captures reuse the audit
redaction helper (credential-looking keys and values become `[redacted]`),
oversized values keep an explicit `…(N more chars)` / `_auditTruncated` marker,
and a shared per-snapshot payload budget keeps the activity part inside its
wire limit.
