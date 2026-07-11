---
"@agent-native/core": patch
---

Attach a pending approval key to the Agent-Native Code tool-call transcript item so the shared inline `ApprovalAffordance` (Approve/Deny) can render directly under the paused bash call, instead of only through a separate host banner. `ApprovalContext` gains optional `onDeny` and `onAlwaysAllow` hooks (both additive; existing consumers keep today's Approve-only, local-Deny behavior when they don't supply them), and `AssistantChat` accepts an optional `approvalActions` prop to wire them. `createCodeAgentChatAdapter` now resolves an approved Code tool call through `controller.control("approve")` instead of treating the approval message as a new prompt.
