---
"@agent-native/core": minor
---

Track transactional email sends as `email.sent`, with `email.send_failed` for a
rejected send so an outage is not indistinguishable from a quiet week. Both
carry `template_id`, `app`, `org_id`, `provider`, and the recipient's domain;
recipient address, subject, and provider error text stay in `email_log`.

Move the HTTP request telemetry switches into app config as
`observability.httpTelemetryDisabled` and `observability.httpTelemetrySampleRate`.
`AGENT_NATIVE_HTTP_TELEMETRY_DISABLED` and
`AGENT_NATIVE_HTTP_TELEMETRY_SAMPLE_RATE` keep working as declared aliases for
those fields, and an out-of-range sample rate now fails loudly at config parse
instead of being silently clamped.

Rename `observability.enabled` to `observability.aiTelemetryEnabled`. A bare
`enabled` in a domain that also gates MCP events, eval sampling, and HTTP
telemetry read as the switch for all of them; it only ever governed agent run,
model call, and tool call traces. `AGENT_NATIVE_OBSERVABILITY` is unchanged, and
`enabled` keeps working — `getObservabilityConfig` folds it in and it wins while
both are set — so no deployment changes behavior. Update it at your convenience;
`ObservabilityConfig.enabled` on the resolved config object is gone.
