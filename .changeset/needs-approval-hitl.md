---
"@agent-native/core": minor
---

Add opt-in per-action human-in-the-loop approvals. Actions can now declare
`needsApproval` (a boolean or an `(args, ctx) => boolean | Promise<boolean>`
predicate) on `defineAction`. When the gate resolves truthy, the agent loop does
NOT execute `run()`: it emits an `approval_required` event carrying the tool
name, a compact view of the input, and a stable `approvalKey`, then pauses the
turn. A human approves by re-issuing the turn with that key in
`AgentChatRequest.approvedToolCalls`, which lets the specific call run. The gate
is default-off and fail-closed (a throwing predicate requires approval). The
mail template's `send-email` action opts in as the canonical example.
