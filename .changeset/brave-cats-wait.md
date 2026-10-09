---
"@agent-native/core": minor
"@agent-native/agentkit": minor
"@agent-native/toolkit": patch
---

Enforce AI readiness at chat dispatch and provide a consistent connection flow.

`createProductionAgentHandler` now requires the `assertAiSetupReady` callback. Existing callers must provide a readiness assertion before upgrading; refusals can use the existing `onRunNotStarted` callback to retain the user's prompt and retry context.

AgentKit transports must provide `assertAiSetupReady`, or clients for transports where shared Agent-Native provider setup does not apply must set `aiSetupReadiness: "not-applicable"` explicitly.
