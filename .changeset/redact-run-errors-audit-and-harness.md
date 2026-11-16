---
"@agent-native/core": patch
---

Redact credentials in agent run errors before they are stored or streamed, in an ACP harness's stderr when it exits early, and in audit rows (adds `dsn`, database and connection URL fields, and an OAuth `code` field to the audit key list).
