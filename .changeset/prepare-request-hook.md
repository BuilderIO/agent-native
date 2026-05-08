---
"@agent-native/core": patch
---

Add an optional `prepareRequest` hook on `ProductionAgentOptions` and `AgentChatPluginOptions` so templates can normalize the inbound chat request — materialize uploaded attachments into per-template file handles, rewrite the message, or append non-visible instructions — between owner resolution and system/context assembly. Re-export `AgentChatAttachment` from the core entry points so templates can type the hook's payload.
