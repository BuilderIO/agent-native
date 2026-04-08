---
title: "Getting Started"
description: "Pick a template, create your app, and start customizing it with AI."
---

# Getting Started

The fastest way to get started is to pick a template and customize it. Templates are complete, production-ready apps — not starter kits. You get a working app in under a minute and start making it yours.

## Create Your App {#create-your-app}

```bash
npx @agent-native/core create my-app
```

The CLI walks you through picking a template — or starting blank. Then run it:

```bash
cd my-app
pnpm install
pnpm dev
```

That's it — you have a full app running locally with an AI agent built in. Open the agent panel, ask it to do something, and watch it work.

From here, use your AI coding tool (Claude Code, Cursor, Windsurf, etc.) to customize it. The agent instructions in `AGENTS.md` are already set up so any tool understands the codebase.

## Templates {#templates}

Each template is a complete app with UI, agent actions, database schema, and AI instructions ready to go:

| Template                          | Replaces                    |
| --------------------------------- | --------------------------- |
| [Mail](/templates/mail)           | Superhuman, Gmail           |
| [Calendar](/templates/calendar)   | Google Calendar, Calendly   |
| [Content](/templates/content)     | Notion, Google Docs         |
| [Slides](/templates/slides)       | Google Slides, Pitch        |
| [Video](/templates/video)         | video editing               |
| [Analytics](/templates/analytics) | Amplitude, Mixpanel, Looker |

Browse the [template gallery](/templates) for live demos and detailed feature lists.

## Project Structure {#project-structure}

Every agent-native app — whether from a template or from scratch — follows the same structure:

```text
my-app/
  app/             # React frontend (routes, components, hooks)
  server/          # Nitro API server (routes, plugins)
  actions/         # Agent-callable actions
  .agents/         # Agent instructions and skills
```

Templates add domain-specific code on top of this: database schemas in `server/db/`, API routes in `server/routes/api/`, and actions in `actions/`.

## Configuration {#configuration}

Templates come pre-configured. If you're starting from scratch, here are the config files:

```ts
// vite.config.ts
import { defineConfig } from "@agent-native/core/vite";
export default defineConfig();
```

```json
// tsconfig.json
{ "extends": "@agent-native/core/tsconfig.base.json" }
```

```ts
// tailwind.config.ts
import type { Config } from "tailwindcss";
import preset from "@agent-native/core/tailwind";

export default {
  presets: [preset],
  content: ["./app/**/*.{ts,tsx}"],
} satisfies Config;
```

## Architecture Principles {#architecture-principles}

These principles apply to all agent-native apps. Understanding them helps you customize templates or build from scratch:

1. **Agent + UI are equal partners** — Everything the UI can do, the agent can do, and vice versa. They share the same database and always stay in sync. You don't think about "the agent" and "the app" separately — you think about them together.
2. **Context-aware** — The agent always knows what you're looking at. If an email is open, it knows which one. If you select text and hit Cmd+I, it can act on just that selection.
3. **Skills-driven** — Core functionalities have instructions so the agent doesn't explore from scratch every time. When you add a feature, you update all four areas: UI, actions, skills/instructions, and application state.
4. **Inter-agent communication** — Agents can discover and call each other via the A2A protocol. Tag your analytics agent from the mail app to pull data into a draft.
5. **Fully portable** — Any SQL database Drizzle supports, any hosting backend Nitro supports, any AI coding tool. These are non-negotiable.
6. **Fork and customize** — Single-tenant apps you clone and evolve. The agent can modify the app's own code — components, routes, styles, actions — so it gets better over time.
