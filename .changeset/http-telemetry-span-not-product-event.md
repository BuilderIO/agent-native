---
"@agent-native/core": patch
---

Stop emitting per-request `http.response` product events. Request timing now goes to an OpenTelemetry `http.server` span, and cold or slow requests write an `agent-native.slow_request` log line. `AGENT_NATIVE_HTTP_TELEMETRY_SAMPLE_RATE` is removed.
