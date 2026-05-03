---
title: "What Is Agent-Native?"
description: "Why most AI apps feel half-built, what makes an app truly agent-native, and what your day-to-day experience looks like as a result."
---

# What Is Agent-Native?

Agent-native is a way of building software where the AI agent and the UI are **equal partners**. Everything the agent can do, the UI can do. Everything the UI can do, the agent can do. They share the same database, the same state, and they stay in sync.

If you only remember one thing from this page, remember this: most AI apps today stop one step short of being useful, and that gap is the biggest mistake in the space right now.

## What it looks like as a user {#what-it-looks-like}

Picture your inbox, calendar, or analytics dashboard. Now picture an agent panel docked on the right side of that app. You can:

- **Click anything you'd normally click.** All the buttons, lists, dashboards, keyboard shortcuts — they all still work. This is a real app, not a chat window pretending to be one.
- **Or just ask.** Type "reply to the email from Sara saying I'll be there by 3" into the agent. It opens the right thread, drafts the reply, and shows it to you for approval — exactly as if you'd done it by hand.
- **See what it sees.** Open an email, and the agent knows which one. Select a chart, and the agent knows which chart. Highlight a paragraph and hit Cmd+I, and the agent acts on just that paragraph.
- **Watch it work.** As the agent does things — opens views, edits drafts, runs reports — the UI updates in real time. You can stop it, redirect it, or take over with the mouse at any moment.
- **Steer it like a teammate.** Give feedback, queue another task, edit its instructions, audit what it did yesterday. It remembers, and it gets better at your workflows over time.

That's the experience agent-native is designed for. Now here's why most products don't get there.

## Why most "AI apps" fall short {#the-ladder}

There's a progression most teams climb, and most stop one rung too early.

### Rung 1 — a single LLM call (the anti-pattern) {#rung-one}

A text box sends a prompt, the AI returns a string, and you display it. Maybe with a spinner. There's no way for the user to course-correct, no way for the AI to take action, no way to see what happened or why.

You see this everywhere: "AI features" that are basically a "Summarize" button bolted onto a SaaS product. They look impressive in demos and break the moment reality gets messy. That's not a product; that's a toy.

### Rung 2 — a chat with tools {#rung-two}

Now the AI can _do things_. It has tools — "draft email," "search contacts," "run query" — and a chat interface where it works in front of you, showing tool calls and results as it goes. This is what Claude, ChatGPT, and Cursor look like under the hood.

This is a real step up. But on its own, it's still a chat window. There's no proper UI. No dashboards, no lists, no forms, no keyboard shortcuts, no team collaboration. If the AI gets confused, you're stuck retyping rather than just clicking the right button. Non-developers struggle to get real work done in this format.

### Rung 3 — agent + UI as equal partners {#rung-three}

This is agent-native. You add a real, full-featured app around the agent — and crucially, every action the agent can take is also a button in the UI, and every button the user clicks runs the same logic the agent uses. One implementation, two ways in.

Three things change when you reach rung 3:

- **You stopped adding buttons to a chatbot. You added an agent to an app.** That's a much higher-quality product on both sides.
- **The agent has real context.** It sees what you're looking at, what you've selected, what you just did. It writes to the same database the UI reads from, so its work shows up immediately.
- **External agents can use it too.** Other agent-native apps can call this one's actions over the [A2A protocol](/docs/a2a-protocol). Tools like Claude Desktop can drive it as an [MCP server](/docs/mcp-protocol). One app, many entry points.

That's rung 3. That's agent-native.

## Why every agent needs a UI {#why-every-agent-needs-a-ui}

The hot take in 2026 is "apps are dead, agents will replace UIs, everyone will just text an agent in Telegram." That's wrong.

Even when the agent does all the heavy lifting, humans still need to:

- **See what it's doing** — progress, intermediate output, what it touched
- **Steer it** — give feedback, interrupt, queue the next task
- **Manage it** — edit its instructions, skills, memory, scheduled jobs, connected accounts
- **Inspect its work** — review drafts, audit history, roll back mistakes
- **Share its output** — dashboards, reports, forms, links to send to teammates

At minimum, "a UI for the agent" is an observability and management dashboard. At maximum, it's a full SaaS app with the agent embedded as a co-pilot. Both ends count as agent-native — see [Pure-Agent Apps](/docs/pure-agent-apps) for the minimal end and [Cloneable SaaS](/docs/cloneable-saas) for the maximal end.

## Why every app benefits from an agent {#why-every-app-benefits-from-an-agent}

The flip side is just as important. Existing SaaS products keep hitting the same wall: 80% of what you need works great, and 20% you just can't change. Adding a chat sidebar rarely fixes that — the chat usually can't actually _do_ the things the UI can.

Agent-native flips that. Because every action in the app is defined once and exposed as both a button and an agent tool, the agent can do everything the buttons can — and more — without a separate "AI world" to maintain. Natural language becomes a first-class input alongside clicks.

The argument isn't "agents replace UI." It's "**agents belong inside applications, with a UI on top, as equal partners**." Neither can stand alone.

## Agent + UI parity {#agent-ui-parity}

This is the defining principle.

> **From the UI** — click buttons, fill forms, navigate views. The UI writes to the database; the agent sees the results.
>
> **From the agent** — natural language, other agents via A2A, Slack, Telegram. The agent writes to the database; the UI updates automatically.

When the agent creates a draft email, it appears in the UI. When you click "Send," the agent knows it was sent. There's no separate "agent world" and "UI world" — it's one system. See [Key Concepts](/docs/key-concepts) for the architecture that makes this work.

## Customization usually reserved for power tools {#workspace-customization}

The reason tools like Claude Code feel so powerful isn't the model — it's the **customization layer**: per-project instructions, skills, memory, sub-agents, connected services. You can shape the agent to your codebase, your preferences, your team.

Agent-native gives every user that same customization layer — without ever leaving the app. Each app comes with a personal **workspace** where you (or anyone on your team) can:

- Edit team-wide rules everyone's agent reads
- Let the agent remember preferences automatically as you correct it
- Write reusable how-to guides as `/slash` commands
- Keep custom sub-agents for specific tasks (invoked with `@mentions`)
- Schedule jobs to run on a cron (e.g. "every Monday morning, summarize last week")
- Connect external services (Gmail, Stripe, Slack, internal APIs) via per-user MCP servers

The twist: it's all stored in the database, not the filesystem. There's no dev environment to spin up, no container per user. Every user gets their own full workspace — personal memory, personal connections, personal skills — for essentially free, because it's all rows in a table. That's what makes Claude-Code-level flexibility viable inside a real multi-tenant SaaS product.

See [Workspace](/docs/workspace) for the full concept.

## What makes it different {#what-makes-it-different}

| Approach                               | Description                                                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Traditional apps with AI bolted on** | The AI is an afterthought. Limited to autocomplete, summaries, or a chat sidebar that can't actually do anything in the app.           |
| **Pure chat / agent interfaces**       | Powerful but inaccessible. No dashboards, no workflows, no persistence. Non-developers can't use them effectively.                     |
| **Claude Code / Codex for SaaS**       | Great for devs on their own machines. Doesn't translate to multi-tenant SaaS — one codebase per user on a dev-box doesn't scale.       |
| **Agent-native apps**                  | The agent is a first-class citizen. It shares the same database, the same state, and can do everything the UI can do — and vice versa. |

## Whole-team development {#whole-team-development}

Agent-native isn't just for developers. Because the agent can edit the app's own code, evolving an app stops being a developer-only activity:

- **Designers** update designs directly in the running app through the agent
- **Product managers** add functionality and update flows by describing them
- **QA** tests the app and asks the agent to fix what's broken
- **Anyone on the team** contributes through natural language

The vision: fewer handoffs, one person doing the work of a small team.

## Fork and customize {#fork-and-customize}

Agent-native apps follow a fork-and-customize model. You start from a **cloneable SaaS** template — Mail, Calendar, Analytics, Slides, Clips, Design, Forms, Dispatch — and make it yours:

1. Pick a template on [agent-native.com/templates](/templates)
2. Use it immediately as a hosted app (e.g. mail.agent-native.com)
3. Fork it when you want to customize — "connect our Stripe account," "add a cohort chart"
4. The agent modifies the code to match your needs
5. Deploy your fork to your own domain — or stay on agent-native.com

Because it's _your_ app, not shared infrastructure, the agent can safely evolve the code. Your app keeps improving as you use it. See [Cloneable SaaS](/docs/cloneable-saas) for the full story.

## Composable agents {#composable-agents}

Agent-native apps can talk to each other. From inside the mail app, you can tag the analytics agent to query data and include the result in a draft email. The agents discover what other agents are available, hand off work between each other, and surface the results in the UI you're already in.

This is powered by [A2A](/docs/a2a-protocol) and [MCP](/docs/mcp-protocol) under the hood — same definition, multiple surfaces — but as a user, all you have to know is "I can ask any of my apps for help with anything any of them can do."

## What does this look like in code? {#what-does-it-look-like-in-code}

If you're building or extending an agent-native app, here's the central pattern: every operation in the app is an **action** — defined once, available to both the agent and the UI.

```ts
// actions/reply-to-email.ts
import { defineAction } from "@agent-native/core";
import { z } from "zod";

export default defineAction({
  description: "Reply to an email thread",
  schema: z.object({ emailId: z.string(), body: z.string() }),
  run: async ({ emailId, body }) => {
    await db.replies.insert({ emailId, body });
  },
});
```

```tsx
// In any React component — same action, called from a button
const { mutate } = useActionMutation("replyToEmail");

<Button onClick={() => mutate({ emailId, body: "Thanks!" })}>
  Send Reply
</Button>;
```

```tsx
// And the agent panel mounted anywhere in your app
import { AgentSidebar } from "@agent-native/core/client";

<AgentSidebar />;
```

One action, four surfaces: the agent calls it as a tool, the UI calls it as a typesafe mutation, external agents reach it over [A2A](/docs/a2a-protocol), and tools like Claude Desktop talk to it as an [MCP server](/docs/mcp-protocol). See [Actions](/docs/actions) for the full reference.

## What's next {#whats-next}

- [**Getting Started**](/docs) — pick a template and run it
- [**Key Concepts**](/docs/key-concepts) — the architecture: SQL, actions, polling sync, context awareness, portability
- [**Cloneable SaaS**](/docs/cloneable-saas) — templates as complete products you own
- [**Workspace**](/docs/workspace) — the per-user customization layer (skills, memory, instructions, MCP) backed by SQL, not files
- [**Dispatch**](/docs/dispatch) — the workspace control plane: secrets vault, Slack/email inbox, cross-app delegation
- [**Tools**](/docs/tools) — sandboxed mini-apps the agent creates instantly without code changes
- [**Drop-in Agent**](/docs/drop-in-agent) — mount `<AgentPanel>` into any React app
