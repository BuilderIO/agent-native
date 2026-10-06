---
"@agent-native/core": minor
---

Agent-loop OpenTelemetry spans now follow the GenAI semantic conventions: `agent.run`, `llm.call`, and `tool.call` become `invoke_agent`, `chat {model}`, and `execute_tool {tool}` with `gen_ai.*` attributes. A registered meter provider also receives `gen_ai.client.operation.duration`, `gen_ai.client.token.usage`, `agent_native.agent.runs`, and `agent_native.tool.calls`. Spans and metrics carry the engine as `gen_ai.provider.name`; on metrics, a model the engine does not list as supported is recorded as `_OTHER`.
