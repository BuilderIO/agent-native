---
"@agent-native/core": patch
---

Add the `agent_native.http.server.handoff.duration` OpenTelemetry histogram. It measures each request until the response hook hands the response back to the runtime, so time a finished response spends waiting (such as an inline telemetry flush) shows up as the gap from `http.server.request.duration`.
