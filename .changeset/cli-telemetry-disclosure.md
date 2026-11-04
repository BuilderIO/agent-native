---
"@agent-native/core": minor
"@agent-native/skills": minor
---

The CLIs now say that they collect anonymous usage data, the first time they would send any, and `agent-native telemetry status|enable|disable|reset` controls it for both CLIs. `AGENT_NATIVE_TELEMETRY_DEBUG=1` prints each event and sends nothing. Crash reports no longer carry raw messages, logs, paths, hostnames or anything from your code, and CLI Sentry reports follow the same off switches. Unknown commands are reported as `unknown` instead of verbatim. See https://agent-native.com/docs/telemetry for everything the CLIs can send.
