---
title: "Getting Started"
description: "Pick a template, create your app, and start customizing it with AI."
---

# Getting Started

By the end of this page, you'll have a working app — Mail, Calendar, Forms, or any other template — running with an AI agent built into the sidebar that can drive every part of it.

## Who is this for? {#who-is-this-for}

There are two ways to use agent-native, depending on how hands-on you want to be:

- **You want to use a hosted version.** Try a template right now at [agent-native.com/templates](/templates). Each template is a live, hosted app — you sign in, start using it, and the agent is already there. No install, no setup. You can stop reading this page and head straight to the [template gallery](/templates).
- **You want to run locally or customize it.** You'll clone a template, run it on your machine, and shape it however you want — branding, features, integrations. The rest of this page is for you. You'll need [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io) installed.

Not sure which path? If you've never written code, the hosted version is for you. If you have a developer or AI coding tool ready, the local path gives you total control.

## First run {#create-your-app}

Three commands and you're up:

```bash
npx @agent-native/core create my-platform
cd my-platform
pnpm install && pnpm dev
```

The `create` command shows a multi-select picker — pick one template or several (Mail + Calendar + Forms, for example) and they all scaffold into one workspace sharing auth, brand, and agent config.

Open the URL the dev server prints (usually `http://localhost:3000`).

## What just happened? {#what-just-happened}

You now have a real, full-featured app running on your machine. Open it in the browser and try it:

- Click around the UI like you would any SaaS product.
- Open the agent panel on the right side. Type something like "show me my settings" or "create a new entry called Welcome." Watch the agent click through the app on your behalf.
- Anything you do by clicking, the agent can do by reading and writing the same database. Anything the agent does shows up in the UI immediately.

That parity between agent and UI is the whole point — see [What Is Agent-Native?](/docs/what-is-agent-native) for the bigger picture.

## What's next {#whats-next}

From here, use any AI coding tool (Claude Code, Cursor, Windsurf, Builder.io) to customize the app. The agent instructions in `AGENTS.md` are already set up so any tool understands the codebase.

Common next steps:

- **Add another app to the same workspace** — run `agent-native add-app` from inside the workspace folder. See [Multi-App Workspace](/docs/multi-app-workspace) for sharing auth, components, and credentials across apps.
- **Single app instead of a monorepo?** Pass `--standalone` when creating: `npx @agent-native/core create my-app --standalone --template mail`.
- **Build a brand-new template from scratch** — see [Creating Templates](/docs/creating-templates) for the full Vite, Tailwind, and TypeScript setup.
- **Understand the architecture** — see [Key Concepts](/docs/key-concepts) for how SQL, actions, polling sync, and context awareness fit together.

## What's next {#next-steps}

Once your app is running, the most common next steps are:

- **Connect Slack or email** so you can message your agent from anywhere — see [Messaging](/docs/messaging).
- **Set up Dispatch as your central inbox** to triage messages and orchestrate across multiple apps — see [Dispatch](/docs/dispatch).
- **Customize via Workspace** — edit instructions, skills, memory, and connect MCP servers per user — see [Workspace](/docs/workspace).

## Templates {#templates}

Each template is a complete app with UI, agent actions, database schema, and AI instructions ready to go:

| Template                            | Replaces                                         |
| ----------------------------------- | ------------------------------------------------ |
| [Mail](/templates/mail)             | Superhuman, Gmail                                |
| [Calendar](/templates/calendar)     | Google Calendar, Calendly                        |
| [Content](/templates/content)       | Notion, Google Docs                              |
| [Slides](/templates/slides)         | Google Slides, Pitch                             |
| [Video](/templates/video)           | video editing                                    |
| [Analytics](/templates/analytics)   | Amplitude, Mixpanel, Looker                      |
| [Clips](/templates/clips)           | Replaces Loom — screen + camera recording        |
| [Design](/templates/design)         | Figma, Canva                                     |
| [Forms](/docs/template-forms)       | Typeform                                         |
| [Dispatch](/docs/template-dispatch) | Workspace control plane — secrets, routing, jobs |
| [Starter](/docs/template-starter)   | Minimal scaffold — build from scratch            |

Browse the [template gallery](/templates) for live demos, or see [Cloneable SaaS](/docs/cloneable-saas) for the full list and the clone → customize → deploy flow.

## Project structure {#project-structure}

Every agent-native app — whether from a template or from scratch — follows the same structure:

```text
my-app/
  app/             # React frontend (routes, components, hooks)
  server/          # Nitro API server (routes, plugins)
  actions/         # Agent-callable actions
  .agents/         # Agent instructions and skills
```

Templates add domain-specific code on top: database schemas in `server/db/`, API routes in `server/routes/api/`, and actions in `actions/`. Building from scratch? See [Creating Templates](/docs/creating-templates) for `vite.config.ts`, `tsconfig.json`, and Tailwind setup.

## Architecture principles {#architecture-principles}

These principles apply to all agent-native apps. Skim them now, revisit them when you're customizing.

1. **Agent + UI are equal partners** — Everything the UI can do, the agent can do, and vice versa. They share the same database and always stay in sync. You don't think about "the agent" and "the app" separately — you think about them together.
2. **Context-aware** — The agent always knows what you're looking at. If an email is open, it knows which one. If you select text and hit Cmd+I, it can act on just that selection.
3. **Skills-driven** — Core functionality has written instructions so the agent doesn't explore from scratch every time. New features update all four areas: UI, actions, skills/instructions, and application state.
4. **Inter-agent communication** — Agents can discover and call each other via the A2A protocol. Tag your analytics agent from the mail app to pull data into a draft.
5. **Fully portable** — Any SQL database Drizzle supports, any hosting backend Nitro supports, any AI coding tool. These are non-negotiable.
6. **Fork and customize** — Apps you clone and evolve. The agent can modify the app's own code — components, routes, styles, actions — so it gets better over time.
