---
"@agent-native/core": patch
---

Stop holding serverless responses on the OpenTelemetry flush when the platform provides `waitUntil`. The response hook now hands the OTel export (including the spans mirrored from tracking events) to `waitUntil`, read from the request or from Netlify's request context, so a slow OTLP collector no longer adds up to 2 seconds to each response. Runtimes without `waitUntil` still wait for the export inline. A failed or timed-out flush also writes one `agent-native.telemetry_flush_failed` line to the function log per signal and error type, because the `agent_native.telemetry.flush_failures` counter cannot reach a collector that keeps timing out.
