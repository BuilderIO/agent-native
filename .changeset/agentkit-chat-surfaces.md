---
"@agent-native/core": minor
"@agent-native/agentkit": patch
"@agent-native/toolkit": patch
---

Move framework chat surfaces to AgentKit while preserving chat history, recovery, context, attachments, model selection, runs, and message actions. This removes the old assistant-ui transcript and stream owners, the `AssistantChat.createAdapter` prop, the public `AssistantMessageActionBar` export, and the adapter APIs `createAgentChatAdapter`, `createCodeAgentChatAdapter`, `createAgentChatRuntimeAdapter`, `codeAgentTranscriptEventsToContent`, and `codeAgentTranscriptHasPendingApproval`, plus their adapter-only options and event types. Use AgentKit `runtime` or `createTransport` for custom chat implementations.
