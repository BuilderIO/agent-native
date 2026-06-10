---
name: delegate-to-agent
description: >-
  How to delegate all AI work to the agent chat. Use when delegating AI work
  from UI or scripts to the agent, when a user asks for agent behavior or
  LLM-powered features, when tempted to add inline LLM calls, or when sending
  messages to the agent from application code.
metadata:
  internal: true
---

# Delegate All AI to the Agent

## Rule

The UI never calls an LLM directly. Product workflows are delegated to the
agent through the chat bridge so users can see, steer, and audit the work.
Server-side one-shot model calls are an explicit escape hatch for narrow text
transforms only; use `completeText()` from `@agent-native/core/server` when the
work intentionally does not need tools, chat history, or run state.

## Why

The agent is the single AI interface. It has context about the full project, can read/write any file, and can run scripts. Inline LLM calls bypass this — they create a shadow AI that doesn't know what the agent knows and can't coordinate with it.

## How

**From the UI (client):**

```ts
import { sendToAgentChat } from "@agent-native/core";

sendToAgentChat({
  message: "Generate a summary of this document",
  context: documentContent, // optional hidden context (not shown in chat UI)
  submit: true, // auto-submit to the agent
});
```

**From the UI, in the background:**

```ts
import { sendToAgentChat } from "@agent-native/core";

sendToAgentChat({
  message: "Analyze this import and create any missing records",
  context: `Import batch id: ${batchId}`,
  submit: true,
  newTab: true,
  background: true,
  openSidebar: false,
});
```

This is still a full agent run: tools, actions, thread state, and run tracking
all remain active. It simply does not focus or open the sidebar.

**From scripts (Node):**

```ts
import { agentChat } from "@agent-native/core";

agentChat.submit("Process the uploaded images and create thumbnails");
```

**For narrow server-side text transforms:**

```ts
import { completeText } from "@agent-native/core/server";

const result = await completeText({
  systemPrompt: "Return exactly one sentiment label.",
  input: messageBody,
  maxOutputTokens: 12,
  temperature: 0,
});
```

Wrap user-facing uses in actions so the UI and agent share the same operation.
Do not call provider SDKs directly.

**From the UI, detecting when agent is done:**

```ts
import { useAgentChatGenerating } from "@agent-native/core";

function MyComponent() {
  const isGenerating = useAgentChatGenerating();
  // Show loading state while agent is working
}
```

## `submit` vs Prefill

The `submit` option controls whether the message is sent automatically or placed in the chat input for user review:

| `submit` value | Behavior                                | Use when                                                                            |
| -------------- | --------------------------------------- | ----------------------------------------------------------------------------------- |
| `true`         | Auto-submits to the agent immediately   | Routine operations the user has already approved                                    |
| `false`        | Prefills the chat input for user review | High-stakes operations (deleting data, modifying code, API calls with side effects) |
| omitted        | Uses the project's default setting      | General-purpose delegation                                                          |

```ts
// Auto-submit: routine operation
sendToAgentChat({ message: "Update the project summary", submit: true });

// Prefill: let user review before sending
sendToAgentChat({
  message: "Delete all projects older than 30 days",
  submit: false,
});
```

## Capture user input first when generating from a prompt

Buttons that produce new content ("New Design", "Create Dashboard", "Make Deck", "Generate Form") need the user's prompt as input. **Never hardcode a generic message** — the result will be a generic generation the user didn't actually ask for.

**Bad** — auto-submits a placeholder message; the user never said what they wanted:

```tsx
<Button
  onClick={() =>
    sendToAgentChat({ message: "make a design", submit: true })
  }
>
  New Design
</Button>
```

**Good** — Popover anchored to the button captures the prompt, then submits it:

```tsx
<Popover open={open} onOpenChange={setOpen}>
  <PopoverTrigger asChild>
    <Button>New Design</Button>
  </PopoverTrigger>
  <PopoverContent className="w-96">
    <Textarea
      autoFocus
      value={prompt}
      onChange={(e) => setPrompt(e.target.value)}
      placeholder="What do you want to design?"
    />
    <Button
      onClick={() => {
        sendToAgentChat({ message: prompt, submit: true });
        setOpen(false);
        setPrompt("");
      }}
    >
      Create
    </Button>
  </PopoverContent>
</Popover>
```

**Always ask for input first when** the output depends on a prompt the user must provide — "design what?", "deck about what?", "dashboard for which metric?", "form for which use case?".

**Auto-submit without input is fine when intent is unambiguous:**

- "Try to fix" on a tool error — submits the error details with a clear fix instruction
- "Retry the last operation" after a transient failure
- Single-purpose buttons where there is nothing meaningful for the user to add

If you find yourself writing `submit: true` with a hardcoded creative verb (`"design a..."`, `"write a..."`, `"build a..."`), stop and add a Popover.

## Delegating to a Sub-Agent (Agent Teams)

`sendToAgentChat()` delegates from app code _to_ the agent. The other axis of
delegation is the agent handing work _to a sub-agent_ through the Agent Teams
run-manager. The main chat stays the orchestrator: it spawns sub-agents, then
reads and integrates their results.

### When to spawn a sub-agent vs do it yourself

- **Do it yourself** when the work is small, on the critical path, or tightly
  coupled to what you're already doing. Sub-agent overhead and coordination risk
  outweigh the benefit.
- **Spawn a sub-agent** for a self-contained unit of work that can run
  independently — a disjoint investigation, an isolated implementation slice, a
  long-running search — especially when it frees the main thread to keep
  orchestrating.

### Briefing contract

Every sub-agent brief must specify four things, or the sub-agent will guess:

- **Objective** — the one concrete outcome it owns, in a sentence.
- **Context** — the facts it needs (paths, prior findings, constraints) so it
  doesn't re-derive them.
- **Output** — the exact shape you want back (a summary, a file edited, a list
  of paths, a yes/no with rationale).
- **Boundaries** — what it must NOT touch (files, branches, side effects) and
  when to stop and report rather than push forward.

### Fan-out discipline

- **Default to a single sub-agent.** Most delegation is one focused task.
- **Spawn multiple only for genuinely independent units** that don't share state
  or files. Never parallelize coupled work — if B needs A's output, run them in
  sequence.
- **Cap parallel fan-out at ~3.** More sub-agents means more synthesis cost and
  more chance of conflicting edits to the same area.

### Synthesis discipline

- **Read every result** before concluding — don't act on the first one back.
- **Reconcile conflicts** between sub-agent findings explicitly; decide which is
  right rather than averaging or ignoring.
- **Integrate into one answer.** The main thread produces the single coherent
  result; it never just forwards raw sub-agent transcripts to the user.

Background sub-agents must use the core run-manager / Agent Teams infrastructure
rather than ad-hoc LLM calls.

## Don't

- Don't `import Anthropic from "@anthropic-ai/sdk"` in client or server code
- Don't `import OpenAI from "openai"` in client or server code
- Don't make direct API calls to any LLM provider
- Don't use AI SDK functions like `generateText()`, `streamText()`, etc.
- Don't build "AI features" that bypass the agent chat
- Don't auto-submit a hardcoded prompt for generative actions — capture user input first (see above)
- Don't use `completeText()` for workflows that need tools, database writes,
  auditability, user steering, or multi-step reasoning. Use the agent chat
  instead, optionally with `background: true`.

## Exception

Scripts may call external APIs (image generation, search, etc.) — but the AI
reasoning and orchestration still goes through the agent. A script is a tool
the agent uses, not a replacement for the agent.

`completeText()` is allowed for small server-side transforms such as
classification, extraction, rewriting a short string, or normalizing messy
provider text. It deliberately runs with `tools: []` and does not create chat
thread state.

## When to Use A2A Instead

`sendToAgentChat()` delegates work to the **local** agent — the one running alongside your app. When the work should go to a **different** agent entirely (e.g., asking an analytics agent for data, or a calendar agent for availability), use the A2A (agent-to-agent) protocol instead.

```ts
import { callAgent } from "@agent-native/core/a2a";

// Call a different agent — not the local agent chat
const stats = await callAgent(
  "https://analytics.example.com",
  "What were last week's signups?",
  { apiKey: process.env.ANALYTICS_A2A_KEY },
);
```

See the **a2a-protocol** skill for the full pattern.

## Related Skills

- **a2a-protocol** — When the work goes to a different agent, not the local one
- **actions** — The agent invokes actions via `pnpm action <name>` to perform complex operations
- **self-modifying-code** — The agent operates through the chat bridge to make code changes
- **storing-data** — The agent writes results to the database after processing requests
- **real-time-sync** — The UI updates automatically when the agent writes data
