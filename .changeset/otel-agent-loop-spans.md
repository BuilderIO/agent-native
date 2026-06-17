---
"@agent-native/core": patch
---

Add an optional OpenTelemetry export to the agent loop. `instrumentAgentLoop`
now wraps the run, each tool call, and the model call in OTel spans
(`agent.run`, `tool.call`, `llm.call`) carrying tool name, model, token usage,
and error attributes. The export is fully no-op unless a host installs
`@opentelemetry/api` (a new optional dependency) and registers a tracer
provider, so there is zero overhead by default and no heavy SDK is added to
core.
