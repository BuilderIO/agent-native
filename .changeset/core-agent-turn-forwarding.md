---
"@agent-native/core": minor
---

`executeAgentToolCall` accepts optional `automation` and `runId` and hands them to the action it runs, so an action called through the guarded executor sees its automation lineage and its audit event carries the run id. New `persistAgentTurnToThread` (exported from `@agent-native/core/server`) saves a finished turn's prompt, tool calls and reply into a chat thread, so a turn run directly through `runAgentLoop` can be opened afterwards.
