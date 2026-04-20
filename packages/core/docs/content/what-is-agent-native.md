---
title: "What Is Agent-Native?"
description: "The ladder from a naked llm() call to a full agent-native app — and why every agent needs a UI (and every app benefits from an agent)."
---

# What Is Agent-Native?

Agent-native is a way of building software where the AI agent and the UI are **equal partners**. Everything the agent can do, the UI can do. Everything the UI can do, the agent can do. They share the same database, the same state, and they stay in sync.

If you only remember one thing from this page, remember this: most AI apps today stop at the first rung of the ladder, and it's the biggest mistake in the space right now.

## The ladder {#the-ladder}

Here's the progression. Most teams stop at rung 1. Agent-native is rung 3.

### Rung 1 — a single LLM call (the anti-pattern) {#rung-one}

```ts
const output = await llm(prompt);
```

A text box sends a prompt, you get a string back, maybe you parse it, and you render it. There's no way for the user to course-correct, no way for the LLM to take action, no way to inspect what happened. Non-deterministic output → deterministic pipeline. It breaks the moment reality gets messy.

You see this everywhere: "AI features" bolted onto SaaS that are basically `fetch('/summarize')` with a spinner. That's not AI product; that's a toy.

### Rung 2 — tools and a loop {#rung-two}

```ts
const loop = query({ prompt, tools });
for await (const msg of loop) {
  if (msg.type === "tool_use") {
    // run the tool, feed the result back into the loop
  }
  if (msg.type === "result") {
    output = msg.text;
  }
}
```

Now the LLM can _do things_. You give it tools (`draftEmail`, `searchEmails`, `queryData`) and run a loop: LLM requests a tool → your code runs it → result goes back → loop continues until the task is done. This is what Claude Code, Codex, and the Anthropic/OpenAI agent SDKs all do under the hood.

This is a real step up. But on its own it still assumes the agent is correct. When it's not, the user has no steering wheel.

So the next move is obvious: stream the agent's work into a chat UI where the user can watch, interrupt, give feedback, queue the next message. That's the state of the art today — and it's still not enough for a real product.

### Rung 3 — `<Agent />` + actions + workspace {#rung-three}

```tsx
// actions/reply-to-email.ts
import { defineAction } from "@agent-native/core";
import { z } from "zod";

export default defineAction({
  description: "Reply to an email thread",
  schema: z.object({
    emailId: z.string(),
    body: z.string(),
  }),
  run: async ({ emailId, body }) => {
    await db.replies.insert({ emailId, body });
  },
});
```

```tsx
// Anywhere in your React app
import { AgentSidebar } from "@agent-native/core/client";

<AgentSidebar />;
```

```tsx
// The same action, typesafe, from a button
const { mutate } = useActionMutation("replyToEmail");

<Button onClick={() => mutate({ emailId, body: "Thanks!" })}>
  Send Reply
</Button>;
```

One action. The agent calls it as a tool. The UI calls it as an HTTP endpoint. External agents call it over [A2A](/docs/a2a-protocol). Claude Desktop calls it as an [MCP server](/docs/mcp-protocol). Four surfaces, one implementation.

And you didn't just add buttons to a chatbot — you added an agent to an app. The user has a real UI with dashboards, lists, forms, and keyboard shortcuts. The agent has real tools, real memory, and real context. Both write to the same database; both see the same state.

That's rung 3. That's agent-native.

## Why every agent needs a UI {#why-every-agent-needs-a-ui}

The hot take floating around right now is "apps are dead, agents will replace UIs, everyone will just text an agent in Telegram." That's wrong.

Every agent eventually needs a UI. Even if the agent does all the _work_, humans still need to:

- **See what it's doing** — progress, tool calls, intermediate output
- **Steer it** — give feedback, interrupt, queue the next task
- **Manage it** — edit its instructions, skills, memory, scheduled jobs, connected accounts
- **Inspect its work** — review drafts, audit trails, rollbacks
- **Share its output** — dashboards, reports, forms, links

At minimum, "a UI for the agent" is an observability + management interface. At maximum, it's a full SaaS app with an agent embedded in it. Both ends of that spectrum are agent-native — see [Pure-Agent Apps](/docs/pure-agent-apps) for the minimal end and [Cloneable SaaS](/docs/cloneable-saas) for the maximal end.

## Why every app benefits from an agent {#why-every-app-benefits-from-an-agent}

The flip side is equally important. Existing SaaS products hit a wall: 80% of what you need, and 20% you can't change. Bolting a sidebar chat onto a SaaS app rarely works because the chat can't actually _do_ the things the UI can.

Agent-native flips that. Because every action in the app is defined once and exposed as both a UI handler and an agent tool, the agent can do everything the buttons can — and a lot more — without a separate "AI world" to maintain. Natural language becomes a first-class input alongside clicks.

The argument isn't "agents replace UI." It's "**agents belong inside applications, with a UI on top, as equal partners**." Neither can stand alone.

## Agent + UI parity {#agent-ui-parity}

This is the defining principle.

> **From the UI** — click buttons, fill forms, navigate views. The UI writes to the database; the agent sees the results.
>
> **From the agent** — natural language, other agents via A2A, Slack, Telegram. The agent writes to the database; the UI updates automatically.

When the agent creates a draft email, it appears in the UI. When the user clicks "Send," the agent knows it was sent. There's no separate "agent world" and "UI world" — it's one system. See [Key Concepts](/docs/key-concepts) for the architecture that makes this work.

## Customization that's usually reserved for Claude Code {#workspace-customization}

The reason tools like Claude Code and Codex are so powerful isn't the model — it's the **customization layer**: per-project instructions, skills, memory files, sub-agents, connected MCP servers. You can shape the agent to your codebase, your preferences, your team.

Agent-native ships the same customization layer as a first-class part of every app — the **workspace**. Each app includes:

- `AGENTS.md` — team-wide rules (shared)
- `learnings.md` — per-user memory the agent writes to automatically (personal)
- `skills/` — reusable how-to guides (`/slash` commands)
- `agents/` — custom sub-agent profiles (invoked with `@mentions`)
- `jobs/` — scheduled tasks that run on a cron
- MCP servers — local _or_ remote, per-user or per-org

The twist: it's **SQL-backed, not filesystem-backed.** There's no dev-box to spin up, no container per user, no files to sync. Every user gets their own full workspace — personal memory, personal MCP servers, personal skills — for essentially free, because it's all rows in a database. That makes this model viable for real SaaS: multi-tenant, deployable to any serverless or edge host, with Claude-Code-level flexibility per user.

See [Workspace](/docs/resources) for the full concept.

## What makes it different {#what-makes-it-different}

| Approach                               | Description                                                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Traditional apps with AI bolted on** | The AI is an afterthought. Limited to autocomplete, summaries, or a chat sidebar that can't actually do anything in the app.           |
| **Pure chat / agent interfaces**       | Powerful but inaccessible. No dashboards, no workflows, no persistence. Non-developers can't use them effectively.                     |
| **Claude Code / Codex for SaaS**       | Great for devs on their own machines. Doesn't translate to multi-tenant SaaS — one codebase per user on a dev-box doesn't scale.       |
| **Agent-native apps**                  | The agent is a first-class citizen. It shares the same database, the same state, and can do everything the UI can do — and vice versa. |

## What is agent-native development? {#what-is-agent-native-development}

Agent-native development means building with agents first. Projects are structured so any AI coding tool — Claude Code, Codex, Cursor, Windsurf, Builder.io — reads the same instructions and follows the same patterns.

The payoff: the agent tends to do _better_ than a human developer because you can encode rules like "when you add a feature, also add a skill for it" — the kind of thing humans skip when they're tired or rushed.

## Agents as first-class developers {#agents-as-first-class-developers}

In an agent-native project:

- **AGENTS.md** gives every AI coding tool the same instructions — Claude Code, Cursor, Windsurf, and others all read the same file
- **Skills** teach the agent patterns for specific tasks — adding features, storing data, wiring real-time sync
- **Agent PR reviewers** validate the four-area checklist, that skills were updated, and that code matches conventions
- **Auto-maintained docs and tests** — agents are instructed to keep docs current and tests passing

This is the shift from desktop-first to mobile-first applied to development. Mobile-first didn't mean "no desktop" — it meant designing for mobile constraints first. Agent-native development means designing for agent workflows first, then ensuring humans work effectively too.

## Whole-team development {#whole-team-development}

Agent-native development isn't just for developers:

- **Designers** update designs directly in the code through the agent
- **Product managers** update functionalities and requirements
- **QA** tests and prompts for fixes
- **Anyone on the team** contributes through natural language

The vision: reduce handoffs, enable one-person-to-full-team productivity.

## Fork and customize {#fork-and-customize}

Agent-native apps follow a fork-and-customize model. You start from a **cloneable SaaS** template — Mail, Calendar, Analytics, Slides, Clips, Forms, Dispatch — and make it yours:

1. Pick a template on [agent-native.com](/templates)
2. Use it immediately as a hosted app (e.g. mail.agent-native.com)
3. Fork it when you want to customize — "connect our Stripe account," "add a cohort chart"
4. The agent modifies the code to match your needs
5. Deploy your fork to your own domain — or stay on agent-native.com

Because it's _your_ app, not shared infrastructure, the agent can safely evolve the code. Your app keeps improving as you use it. See [Cloneable SaaS](/docs/cloneable-saas) for the full story.

## Composable agents {#composable-agents}

Agent-native apps talk to each other over the [A2A protocol](/docs/a2a-protocol). From the mail app, you can tag the analytics agent to query data and include the results in a draft email. Agents discover what other agents are available, call them over the protocol, and show results in the UI.

Every action you define is also a tool exposed over A2A _and_ as an MCP server, so external tools like Claude Desktop can drive your app directly. Same definition, four surfaces.

## What's next

- [**Key Concepts**](/docs/key-concepts) — the architecture: SQL, actions, polling sync, context awareness, portability
- [**Cloneable SaaS**](/docs/cloneable-saas) — templates as complete products you own
- [**Workspace**](/docs/resources) — the per-user customization layer (skills, memory, instructions, MCP)
- [**Drop-in Agent**](/docs/drop-in-agent) — mount `<AgentPanel>` into any React app
- [**Getting Started**](/docs) — scaffold your first app
