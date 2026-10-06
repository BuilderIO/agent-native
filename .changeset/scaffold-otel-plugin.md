---
"@agent-native/core": patch
---

New apps scaffolded from first-party templates keep the `@agent-native/otel` startup plugin and install the published package. It stays a no-op until `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
