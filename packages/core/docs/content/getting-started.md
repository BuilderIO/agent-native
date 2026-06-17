---
title: "Getting Started"
description: "Choose the right path: hosted apps, local setup, agent-native skills, or external-agent connections."
---

# Getting Started

Agent-Native is for apps where a real UI and an AI agent share the same actions, data, and state. This page helps you choose the right starting point, then walks through the local setup path.

## Pick your path {#who-is-this-for}

Start with the path that matches what you want to do next:

- **Use a starter app.** Browse the [template gallery](/templates). Hosted apps already include sign-in, data, and the agent sidebar. No install required.
- **Build or customize your own app.** Continue with [Create a local app](#create-your-app). You'll scaffold a template, run it locally, then change the code, brand, data model, and integrations.
- **Choose headless, chat, embedded, or full app.** Use [Agent Surfaces](/docs/agent-surfaces) when you know the workflow but not how much UI belongs around it.
- **Add agent-native skills to a code tool.** Jump to [Try it with a skill](#try-with-a-skill) to add Plans or PR Recaps to Claude Code, Codex, or Cursor without scaffolding an app.
- **Connect an external agent to an app.** Use [External Agents](/docs/external-agents) to connect Claude, ChatGPT, Codex, Cursor, OpenCode, GitHub Copilot / VS Code, or another MCP host to an existing app.

If you're not sure, use the hosted app when you want to use software now. Use the local path when you want to own and change the software.

## Create a local app {#create-your-app}

You'll need [Node.js 22 or newer](https://nodejs.org) and [pnpm](https://pnpm.io) installed. Then run:

```bash
npx @agent-native/core@latest create my-platform
cd my-platform
pnpm install && pnpm dev
```

The `create` command opens a template picker. Pick one template for a single app, or pick several templates to create a workspace where the apps share auth, brand, and agent configuration. If you want one app directory instead of a workspace, pass `--standalone`.

Open the URL the dev server prints. The workspace gateway always starts on port 8080 and serves every app through it; individual apps run on their own ports that are printed at startup. Standalone apps default to `http://localhost:3000`.

### Agent credentials {#agent-credentials}

In local development the embedded agent panel picks up your existing Claude Code or Codex CLI login automatically, or reads `ANTHROPIC_API_KEY` from a `.env` file in the project root. The database defaults to SQLite (stored at `data/app.db`) when `DATABASE_URL` is not set, so you can run the full stack with no external services. For production deployments — where you'll want Postgres, a persistent secret, and bring-your-own-key per user — see [Deployment](/docs/deployment).

## What just happened? {#what-just-happened}

You now have a real app running on your machine with an agent built into it:

- The UI works like a normal SaaS product: routes, forms, tables, settings, and keyboard flows.
- The agent panel can read the current screen and run the same actions the UI runs.
- Changes stay in sync because the UI and agent share the same database and application state.

That parity between agent and UI is the whole point — see [What Is Agent-Native?](/docs/what-is-agent-native) for the bigger picture.

## Pick a template {#templates}

Templates are complete apps, not blank starters. Choose one when you want a familiar product to customize:

- **Productivity apps** — [Mail](/docs/template-mail), [Calendar](/docs/template-calendar), [Forms](/docs/template-forms), [Content](/docs/template-content), [Slides](/docs/template-slides), [Design](/docs/template-design), [Clips](/docs/template-clips), and [Video](/docs/template-videos)
- **Team and data apps** — [Analytics](/docs/template-analytics), [Brain](/docs/template-brain), [Dispatch](/docs/template-dispatch), [Assets](/docs/template-assets), and [Plan](/docs/template-plan)
- **Bare starting point** — [Starter](/docs/template-starter), a minimal app with the framework wiring and no domain model

Browse the [template gallery](/templates) for live hosted apps. See [Templates](/docs/cloneable-saas) for the full catalog and the clone → customize → deploy flow.

## Add more apps to a workspace {#creating-vs-adding-apps}

`create` (above) makes a brand-new workspace. Once you have one, add more apps to it with `add-app`, run from the workspace root:

```bash
cd my-platform
npx @agent-native/core@latest add-app
pnpm install
pnpm dev
```

If your terminal is inside `apps/content` or another app folder, the CLI still detects the workspace and adds the new app as a sibling under `apps/`. Go back to the workspace root before running `pnpm install` or `pnpm dev`.

To add another app from a specific template, pass a name and `--template`:

```bash
npx @agent-native/core@latest add-app design-lab --template design
```

## Try it with a skill {#try-with-a-skill}

Don't want to scaffold an app? Add agent-native capabilities to a coding agent you already use. Installing the **Plans** skill turns the plans your agent writes into structured, reviewable docs with diagrams, wireframes, and inline comments:

```bash
npx @agent-native/core@latest skills add visual-plan
```

That one command installs the skill instructions, registers the hosted MCP connector, and signs you in — no marketplace browsing, no manual OAuth. Then run `/visual-plan` in your agent. See the [Skills Guide](/docs/skills-guide#app-backed-skills) for more skills, local/offline installs, and how app-backed skills work.

Need the opposite direction, where Claude, ChatGPT, Codex, Cursor, OpenCode, GitHub Copilot / VS Code, or another MCP host calls an agent-native app? Use [External Agents](/docs/external-agents).

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

The three principles that apply to every agent-native app:

- **Agent + UI are equal partners** — everything the UI can do, the agent can do, and vice versa; they share the same database.
- **Everything is an action** — agent tools, UI mutations, HTTP endpoints, MCP tools, and CLI commands are all the same `defineAction()` definition.
- **All state in SQL** — app state, navigation, drafts, and settings live in the database so both agent and UI always see the same picture.

The definitive six rules are in [Key Concepts](/docs/key-concepts).

## Common next moves {#next-docs}

Once your app is running, the usual next step is small and concrete:

- **Ask the built-in agent what it sees** — open the agent panel and type "what app am I looking at, and what can you do here?" This verifies that the app, UI state, and agent loop are connected.
- **Make one customization** — rename the app, change the first screen copy, or add a field to a form. The project `AGENTS.md` already tells coding agents how this repo is organized.
- **Deploy it** — see [Deployment](/docs/deployment) when you're ready to put the app on your own domain.

Useful follow-up docs:

- [Key Concepts](/docs/key-concepts) for the architecture: SQL, actions, polling sync, and context awareness
- [Agent Surfaces](/docs/agent-surfaces) for choosing headless, rich chat, embedded sidecar, or full app
- [Workspace](/docs/workspace) for instructions, skills, memory, and per-user MCP connections
- [Messaging](/docs/messaging) for Slack, email, Telegram, and other ways to reach the agent
- [FAQ](/docs/faq) for setup and product questions
