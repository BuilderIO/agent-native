---
title: "What Is Agent-Native?"
description: "What agent-native apps are, what agent-native development means, and why every AI agent needs a management interface."
---

# What Is Agent-Native?

Agent-native is a way of building software where the AI agent and the UI are equal partners. Everything the agent can do, the UI can do. Everything the UI can do, the agent can do.

## What is an agent-native app? {#what-is-an-agent-native-app}

Think of agent-native apps as a layer on top of AI agents. An agent has skills, instructions, and tools. It can be autonomous and general purpose. The application sits on top of that and gives it structure.

Importantly, agent-native does **not** mean "app that calls an LLM." That's the anti-pattern. A text box that sends a prompt and returns a response gives you no ability to give feedback, no way to understand what the agent is doing, and no way to customize its behavior with instructions and skills.

An agent-native app gives you everything good about traditional applications — databases, dashboards, workflows, persistence, shareability — plus everything good about AI agents. The agent can do anything the UI can do, and the things it does persist to the UI so you can inspect them, visualize them, and share them.

## Not just a chatbot {#not-just-a-chatbot}

A chat interface alone isn't enough. When you're building tools for people to actually use, you need more than a box for them to type a prompt into:

- **Discoverability** — users need to know what the app can do without guessing prompts
- **Workflows** — structured flows for common tasks like composing emails, creating events, or building forms
- **Visualization** — charts, calendars, email threads, and slide decks are better as visual interfaces than text
- **Persistence** — a dashboard to come back to, data that doesn't disappear between sessions
- **Shareability** — share a form link, a slide deck URL, or a report with your team
- **Speed** — clicking a button is faster than typing a prompt for routine tasks

Agent-native apps give you all of this while keeping the full power of the AI agent. The agent is always there — you can ask it to do anything. But the UI makes common workflows fast, visual, and accessible to everyone on the team.

## Agent + UI parity {#agent-ui-parity}

This is the defining principle. Any application functionality should be able to be done by the agent _or_ the UI:

> **From the UI** — Click buttons, fill forms, navigate views. The UI writes to the database and the agent can see the results.
>
> **From the agent** — Natural language, other agents via A2A, Slack, Telegram. The agent writes to the database and the UI updates automatically.

When the agent creates a draft email, it appears in the UI. When the user clicks "Send," the agent knows it was sent. There's no separate "agent world" and "UI world" — it's one system.

## What makes it different {#what-makes-it-different}

Every agent ultimately needs a management interface. At the minimum, you need to understand what it's doing, inspect the data it's creating, and debug when things go wrong. That's just called an application.

| Approach                               | Description                                                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Traditional apps with AI bolted on** | The AI is an afterthought. Limited to autocomplete, summaries, or a chat sidebar that can't actually do anything in the app.           |
| **Agent-native apps**                  | The agent is a first-class citizen. It shares the same database, the same state, and can do everything the UI can do — and vice versa. |
| **Pure chat/agent interfaces**         | Powerful but inaccessible. No dashboards, no workflows, no persistence. Non-developers can't use them effectively.                     |
| **Agent-native apps**                  | Full application UI with discoverability, workflows, and visualization — plus the agent for anything that needs AI.                    |

The argument is simple: make your agents composable, think of them as applications. An analytics application, a slide generation application, a document application. Each one is a complete tool that humans and agents can both use.

## What is agent-native development? {#what-is-agent-native-development}

Agent-native development means building with agents first. You build projects that work great when prompted from AI coding tools like Claude Code, Codex, Cursor, Windsurf, and Builder.io.

The idea is that you build instructions and skills into the project as prerequisites. The agent will tend to do _better_ than a human developer because you can encode rules like "when you add a feature, also add a skill for it" — things that humans will tend to forget or skip reading the docs for.

## Agents as first-class developers {#agents-as-first-class-developers}

In an agent-native project:

- **AGENTS.md** gives every AI coding tool the same instructions — Claude Code, Cursor, Windsurf, and others all read the same file
- **Skills** teach the agent patterns for specific tasks — adding features, storing data, wiring real-time sync
- **Agent PR reviewers** can validate that the four-area checklist was followed, that skills were updated, and that the code matches the project's conventions
- **Auto-maintained docs and tests** — agents can be instructed to keep documentation up to date and tests passing, making it easier for humans to contribute

This is similar to the shift from desktop-first to mobile-first development. Mobile-first didn't mean "no desktop" — it meant designing for mobile constraints first and then scaling up. Agent-native development means designing for agent workflows first and then making sure humans can work effectively too.

## Whole-team development {#whole-team-development}

Agent-native development isn't just for developers. The goal is actual agent-native development as a team:

- **Designers** can update designs directly in the code through the agent
- **Product managers** can update functionalities and requirements
- **QA** can test and prompt for fixes
- **Anyone on the team** can contribute through natural language

The vision is to reduce handoffs and enable one-person-to-full-team productivity using real collaboration between humans and agents.

## Fork and customize {#fork-and-customize}

Agent-native apps follow a single-tenant, fork-and-customize model. You start from a template — mail, calendar, analytics, slides — and make it yours:

1. Pick a template on [agentnative.com](/templates)
2. Start using it immediately as a hosted app (e.g. mail.agentnative.com)
3. Fork it when you want to customize — "connect to our Stripe account", "add a cohort chart"
4. The agent modifies the code to match your needs
5. Deploy your fork to your own domain

Because it's your app — not shared infrastructure — the agent can safely evolve the code over time. Your app keeps improving as you use it.

## Composable agents {#composable-agents}

Agent-native apps can communicate with each other using the [A2A protocol](/docs/a2a-protocol). From the mail app, you can tag the analytics agent to query data and include results in a draft. An agent discovers what other agents are available, calls them over the protocol, and shows results in the UI.

This is why agent-native is a **framework and not a library**. The architecture — shared database, polling sync, actions, application state — needs to be built in from the ground up. You can migrate existing apps, but the best practice is to build agent-native from the start.

See the [Key Concepts](/docs/key-concepts) doc for the full technical details.
