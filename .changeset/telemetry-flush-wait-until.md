---
"@agent-native/core": patch
---

Send response telemetry after the response instead of before it. The OpenTelemetry and analytics flush now runs through the platform's `waitUntil` (including Netlify's invocation context), so a slow OTLP collector no longer adds up to 2 seconds to every serverless request. A timed-out or failed flush also writes one `agent-native.telemetry_flush_failed` line to the function log per signal and error type, because the `agent_native.telemetry.flush_failures` counter cannot reach a collector that keeps timing out.
