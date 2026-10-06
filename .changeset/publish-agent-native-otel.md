---
"@agent-native/otel": minor
---

First npm release of `@agent-native/otel`. Call `startAgentNativeOtel()` from a server plugin to export Core's metrics and traces over OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` (or a per-signal endpoint) is set; without one it does nothing.
