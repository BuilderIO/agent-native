---
title: "Agent Teams"
description: "The main agent delegates work to sub-agents that run in their own threads and appear as live preview chips inline in chat."
---

# Agent Teams

The agent chat is an **orchestrator**, not a monolith. When the main agent hits a task that's better owned by a specialist — "write this email in my voice," "run a BigQuery analysis," "review this PR" — it spawns a sub-agent in its own thread, tools, and context. The sub-agent shows up as a live preview **chip** inline in the main chat; click it to open the full conversation as a tab.

This keeps the main thread focused, lets sub-agents run in parallel, and gives you a clean audit trail for any delegated work.

## The mental model {#mental-model}

- **Main chat** — the orchestrator. Reads your request, delegates. Rarely does heavy work itself.
- **Sub-agents** — run with their own thread, their own system prompt, their own tool set. Each maps to a "custom agent" profile in the [workspace](/docs/workspace).
- **Chips** — the rich preview card that appears inline in the main chat, showing the sub-agent's current step, streaming output, and final summary. Collapsed by default; expands to the full conversation on click.
- **Bidirectional messaging** — the main agent can send follow-ups to a running sub-agent; a sub-agent can message back when it hits an ambiguous point.

Sub-agent state is persisted in the `application_state` SQL table (under `agent-task:<taskId>`), so tasks survive serverless cold starts and work across multiple processes.

## When to spawn a sub-agent {#when-to-spawn}

Spawn when the task:

- Needs a different **system prompt** (a specialist voice or tone, e.g., "code review").
- Has a **long-running** tool chain that would pollute the main context.
- Can run **in parallel** with other work the main agent is doing.
- Is owned by a **different team** that already has a custom agent profile.

Don't spawn for trivial one-shot work — call the action directly.

## Invoking a sub-agent {#invoking}

Three ways to kick off a sub-agent, from least to most explicit:

### 1. `@mention` a custom agent {#mention}

The user types `@agent-name` in the chat composer. A dropdown of workspace sub-agents appears. Selecting one inserts a chip; on submit the main agent delegates the message to that sub-agent.

Custom agents live in the workspace at `agents/<slug>.md` — a Markdown file with YAML frontmatter. See [Custom Agents](/docs/workspace#custom-agents) for the format.

### 2. The main agent delegates automatically {#auto-delegate}

The framework gives the main agent a `delegate-to-agent` tool. When the model decides a task fits a registered sub-agent profile, it calls the tool. A chip appears; the sub-agent runs. The main agent waits (or moves on in parallel) and incorporates the result when the sub-agent finishes.

### 3. Programmatic spawn {#programmatic-spawn}

For framework-level integrations, use `spawnTask()` from `@agent-native/core/server`:

```ts
import { spawnTask } from "@agent-native/core/server";

const task = await spawnTask({
  description: "Draft an outreach email to this lead",
  instructions: "Match Steve's voice from memory/MEMORY.md.",
  ownerEmail: user.email,
  systemPrompt: mailAgentSystemPrompt,
  actions: mailActions,
  apiKey: process.env.ANTHROPIC_API_KEY!,
  parentSend: emit, // streaming sender for the parent chat response
});
```

Most app code won't call this directly — the framework does it under the hood for `@mentions` and for the `delegate-to-agent` tool. Reach for `spawnTask()` only when you're wiring a new entry point (e.g., a button that kicks off a background job that runs as a sub-agent).

## Task lifecycle {#lifecycle}

```
spawnTask()
  ├─ creates a new thread in chat_threads (with the description as the first user message)
  ├─ writes agent-task:<taskId> to application_state (status=running)
  ├─ emits agent_task_started to the parent stream → chip appears in the UI
  ├─ runs the agent loop in the background
  │   └─ emits agent_task_step events → chip updates live
  ├─ on completion: updates status=completed, writes summary + preview
  └─ emits agent_task_done → chip shows final summary
```

At any point the parent agent can resume the sub-agent with a follow-up via `sendToTask(taskId, message)`. If the sub-agent errors, `markTaskErrored(taskId, reason)` records the failure and surfaces it to the user.

## Reading task state {#reading-state}

From server code or other actions:

```ts
import { getTask, listTasks } from "@agent-native/core/server";

const task = await getTask(taskId); // single task
const tasks = await listTasks(); // all tasks for the user (sorted newest first)
```

`AgentTask` shape:

```ts
interface AgentTask {
  taskId: string;
  threadId: string;
  description: string;
  status: "running" | "completed" | "errored";
  preview: string; // short one-liner for the chip
  summary: string; // full summary once completed
  currentStep: string; // latest step label (updated while running)
  createdAt: number;
}
```

## Custom agent profiles {#profiles}

A custom agent is a Markdown file in the workspace:

```markdown
---
name: Code Review
description: >-
  Reviews TypeScript PRs with a focus on correctness, type safety, and API design.
model: inherit
tools: inherit
delegate-default: true
---

# Role

You are a meticulous code reviewer. Focus on correctness, subtle type errors,
and the public API surface. Be terse and concrete — cite file:line wherever
you can.

## Rules

- Prefer "here's the bug" over "here's why this pattern is wrong."
- Never LGTM silently; always summarize what you checked.
```

Store at `agents/code-review.md` in the workspace. It appears in the `@mention` dropdown and is available to the main agent as a delegation target. See [Workspace — Custom Agents](/docs/workspace#custom-agents) for the full format.

## What's next

- [**Workspace — Custom Agents**](/docs/workspace#custom-agents) — the profile format
- [**A2A Protocol**](/docs/a2a-protocol) — when the "sub-agent" lives in a different app entirely
- [**Actions**](/docs/actions) — the tools a sub-agent calls
