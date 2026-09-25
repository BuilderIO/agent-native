---
"@agent-native/core": minor
---

Add `registerObservabilityProvider()` to `@agent-native/core/server` so a host can hand core its OpenTelemetry tracer and meter providers. Core now records the unsampled `http.server.request.duration` histogram and `agent_native.telemetry.flush_failures` counter, and force-flushes registered providers on the response hook with a 2-second cap so serverless exports are not lost.
