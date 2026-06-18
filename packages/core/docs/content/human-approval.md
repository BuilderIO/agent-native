---
title: "Human-in-the-Loop Approvals"
description: "Pause the agent before a high-consequence action runs — defineAction's needsApproval gate emits an approval_required event, the human approves, and only then does the tool execute."
---

# Human-in-the-Loop Approvals

Most actions should just run. A few — sending an email, charging a card, deleting an account — are outward-facing and hard to undo, and you don't want the agent to do them autonomously. For those, `defineAction` has an opt-in **approval gate**: when the agent tries to call the action, the loop pauses, surfaces an Approve/Deny affordance to the human, and runs the action _only_ after the human approves that specific call.

> [!WARNING]
> Keep approvals rare. Every gated action is a hard stop in the agent loop — it interrupts the run and demands a human round-trip. Use `needsApproval` only for genuinely high-consequence, hard-to-undo, outward-facing operations. If you find yourself gating reads or routine writes, you're holding it wrong. The default is **off**, and almost every action should leave it off.

## The `needsApproval` gate {#needs-approval}

Set `needsApproval` on a `defineAction`. It accepts a boolean or a predicate:

```ts
// actions/send-email.ts
export default defineAction({
  description: "Send an email via Gmail.",
  schema: z.object({
    to: z.string(),
    subject: z.string(),
    body: z.string(),
  }),
  // Sending is outward-facing and hard to undo, so the agent can never send
  // without a human approving the specific call. Drafting/queueing is
  // unaffected — only the real send is gated.
  needsApproval: true,
  run: async (args) => {
    /* ...actually send... */
  },
});
```

- **`needsApproval: true`** — always require approval.
- **`needsApproval: (args, ctx) => boolean | Promise<boolean>`** — require approval only when the predicate returns true. Gate conditionally, e.g. only for external recipients or only above a dollar threshold:

  ```ts
  needsApproval: (args) => !args.to.endsWith("@your-company.com"),
  ```

  Keep the predicate pure and fast. **It fails closed**: if the predicate throws, the framework treats that as "approval required" rather than silently running a high-consequence action.

When `needsApproval` is omitted, behavior is byte-for-byte unchanged — there is no extra cost on the common path.

This works the same for legacy `parameters`-style actions and schema-based actions, and for the in-app agent, sub-agents, A2A, and MCP callers (every agent surface routes through the same loop).

## How the loop pauses {#loop}

When the agent calls a gated action and this specific call has **not** already been approved, the loop does **not** execute `run()`. Instead it:

1. Resolves the gate. For a predicate, it calls `needsApproval(input, ctx)`; a throw is treated as "must approve" (fail closed).
2. Emits a `tool_start` event (so the UI shows the call) followed immediately by an **`approval_required`** event, then stops the turn. The action's side effect never happens.

The `approval_required` event carries everything the client needs to render an affordance:

| Field         | Type     | Notes                                                               |
| ------------- | -------- | ------------------------------------------------------------------- |
| `tool`        | `string` | The action name the agent tried to call.                            |
| `input`       | object   | The arguments the agent passed.                                     |
| `approvalKey` | `string` | **Stable key** the client echoes back to approve _this exact call_. |
| `toolCallId`  | `string` | The model-side tool-call id, when available.                        |

The `approvalKey` is derived deterministically from the tool name plus its input, so the same logical call always produces the same key. The model never sees or sets it — it is purely a handshake between the framework and the human's Approve affordance.

The paused tool returns a result telling the model the turn is paused and not to retry, so the model doesn't spin.

## How the human approves {#approve}

On `approval_required`, the chat UI renders an **Approve / Deny** affordance on the paused tool call. This is wired automatically in `AssistantChat` — you don't build it per template.

- **Approve** re-issues the turn (an ordinary continuation message) carrying the call's key in `approvedToolCalls: [approvalKey]`. On the re-issued turn, the gate sees the key in the approved set and lets that specific call run normally.
- **Deny** dismisses the affordance locally; nothing is re-issued, so the action never runs.

`approvedToolCalls` is a field on the chat request (`AgentChatRequest.approvedToolCalls`). Keys not present in it stay paused — approving one call never blankly approves others. Because the key is content-addressed, an approval authorizes _that call with those arguments_; if the model later proposes a different send, that's a new key and a fresh approval.

## End-to-end {#flow}

```txt
agent calls send-email
   │
   ▼
needsApproval truthy, call not yet approved
   │  loop emits tool_start + approval_required { tool, input, approvalKey }
   ▼
turn pauses — run() did NOT execute
   │
human clicks Approve in the chat UI
   │  client re-issues the turn with approvedToolCalls: [approvalKey]
   ▼
gate sees the key → run() executes → email sends
```

The canonical (and intentionally rare) use of this gate in the framework is the Mail template's `send-email` action, which sets `needsApproval: true` so the agent can draft and queue freely but can never actually send a message without a human approving the specific send.

## Related

- [**Actions**](/docs/actions#needs-approval) — the full `defineAction` surface, including `outputSchema` for validating return values.
- [**Security**](/docs/security) — when to reach for an approval gate vs. hiding an action from the model.
- [**Mail template**](/docs/template-mail) — `send-email` is the reference example.
