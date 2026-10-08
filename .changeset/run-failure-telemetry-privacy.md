---
"@agent-native/core": patch
---

Keep agent run and tool failure messages out of server Analytics, Monitoring, and optional OpenTelemetry exports, including gateway captures and exception flood summaries. Preserve error codes, causes, exception types, HTTP statuses, and stack frames for diagnosis while retaining local owner-scoped run and trace details.
