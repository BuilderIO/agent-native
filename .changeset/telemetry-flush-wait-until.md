---
"@agent-native/core": patch
---

Send response telemetry after the response instead of before it. The OpenTelemetry and analytics flush now runs through the platform's `waitUntil` (including Netlify's invocation context), so a slow OTLP collector no longer adds up to 2 seconds to every serverless request.
