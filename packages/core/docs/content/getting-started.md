---
title: "Getting Started"
description: "Start primitive-first with one action, run the local app-agent loop, then add UI, templates, skills, or external-agent access when you need them."
---

# Getting Started

Agent-Native is for apps where an AI agent and any UI around it share the same actions, data, and state. The smallest useful app is not a dashboard. It is one durable action the agent can call, backed by the local runtime.

Start primitive-first: define the work as an action, run it through the app-agent loop, then add chat widgets, screens, templates, or external-agent access only when the workflow needs them.

## Pick your path {#who-is-this-for}

Start with the path that matches what you want to do next:

- **Build a headless agent/action.** Continue with [Create a minimal agent](#create-your-agent). This is the first on-ramp for jobs, integrations, scripts, and "run an agent against my folder" experiments.
- **Add UI around working actions.** Use [Starter](/docs/template-starter) when you want a blank UI scaffold, or a domain [template](/docs/cloneable-saas) when you want finished screens from day one.
- **Use a hosted app.** Browse the [template gallery](/templates). Hosted apps already include sign-in, data, and the agent sidebar. No install required.
- **Choose headless, chat, embedded, or full app.** Use [Agent Surfaces](/docs/agent-surfaces) when you know the workflow but not how much UI belongs around it.
- **Add agent-native skills to a code tool.** Jump to [Try it with a skill](#try-with-a-skill) to add Plans or PR Recaps to Claude Code, Codex, or Cursor without scaffolding an app.
- **Connect an external agent to an app.** Use [External Agents](/docs/external-agents) to connect Claude, ChatGPT, Codex, Cursor, OpenCode, GitHub Copilot / VS Code, or another MCP host to an existing app.

If you are not sure, start with a headless action. Add UI once users need to browse, configure, compare, approve, or share persistent objects.

## Create a minimal agent {#create-your-agent}

You'll need [Node.js 22 or newer](https://nodejs.org) and [pnpm](https://pnpm.io) installed. Then run:

```bash
npx @agent-native/core@latest create my-agent --headless
cd my-agent
pnpm install
```

This creates the smallest local Agent-Native app: an `actions/` folder, the framework runtime, and a SQLite database at `data/app.db` unless you set `DATABASE_URL`. It intentionally has no custom React app or dev server yet.

Add one action:

```ts
// actions/hello.ts
import { defineAction } from "@agent-native/core";
import { z } from "zod";

export default defineAction({
  description: "Say hello from the local agent.",
  schema: z.object({
    name: z.string().default("world"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ name }) => {
    return { message: `Hello, ${name}!` };
  },
});
```

Run it directly:

```bash
pnpm action hello --name Steve
```

Then run the app-agent loop from the same folder:

```bash
pnpm agent "Call the hello action for Steve and explain what happened."
```

That is the local app-agent loop. For "run an agent against this folder" work, start here before reaching for external coding harnesses; the agent runs against the actions, instructions, and runtime in the app you are developing.

### Agent credentials {#agent-credentials}

In local development the headless agent command reads provider credentials from your environment, such as `ANTHROPIC_API_KEY` in a `.env` file in the project root. Browser chat surfaces can also use configured agent credentials. The full loop is not stateless: actions, auth/session data, application state, threads, and run history use SQL. Locally that defaults to SQLite; in production you will usually point `DATABASE_URL` at Postgres or another persistent SQL database. See [Deployment](/docs/deployment).

## What just happened? {#what-just-happened}

You now have a real local app-agent loop:

- `hello` is one action definition, available to the agent, CLI, HTTP, MCP, A2A, and any future UI.
- `pnpm agent` calls the same production app-agent loop used by chat, jobs, webhooks, and hosted runtimes.
- Changes and history stay in sync because the local runtime uses SQL-backed state, even when you have no custom UI yet.

That parity between agent and UI is the whole point — see [What Is Agent-Native?](/docs/what-is-agent-native) for the bigger picture.

## Add UI when you need it {#templates}

Headless actions are the default starting point. Add UI when humans need a durable surface around those actions: lists, editors, review states, dashboards, permissions, or shared objects.

Use a template when you want finished product UX to customize:

- **Productivity apps** — [Mail](/docs/template-mail), [Calendar](/docs/template-calendar), [Forms](/docs/template-forms), [Content](/docs/template-content), [Slides](/docs/template-slides), [Design](/docs/template-design), [Clips](/docs/template-clips), and [Video](/docs/template-videos)
- **Team and data apps** — [Analytics](/docs/template-analytics), [Brain](/docs/template-brain), [Dispatch](/docs/template-dispatch), [Assets](/docs/template-assets), and [Plan](/docs/template-plan)
- **Blank UI scaffold** — [Starter](/docs/template-starter), for when you are ready to add screens but none of the domain templates fit

For a UI-first app from day one:

```bash
npx @agent-native/core@latest create my-platform --template mail
cd my-platform
pnpm install && pnpm dev
```

The `create` command can also open a template picker. Pick one template for a single app, or pick several templates to create a workspace where the apps share auth, brand, and agent configuration. Browse the [template gallery](/templates) for live hosted apps. See [Templates](/docs/cloneable-saas) for the full catalog and the clone -> customize -> deploy flow.

Future "graft UI onto this headless action" tooling should use a distinct verb or namespace. `agent-native add` already means integration blueprints such as providers, channels, and sandbox adapters; it is not the UI-grafting command.

## Add more apps to a workspace {#creating-vs-adding-apps}

`create` makes a brand-new app or workspace. Once you have a workspace, add more apps to it with `add-app`, run from the workspace root:

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

Do not want to scaffold an app? Add agent-native capabilities to a coding agent you already use. Installing the **Plans** skill turns the plans your agent writes into structured, reviewable docs with diagrams, wireframes, and inline comments:

```bash
npx @agent-native/core@latest skills add visual-plan
```

That one command installs the skill instructions, registers the hosted MCP connector, and signs you in — no marketplace browsing, no manual OAuth. Then run `/visual-plan` in your agent. See the [Skills Guide](/docs/skills-guide#app-backed-skills) for more skills, local/offline installs, and how app-backed skills work.

Need the opposite direction, where Claude, ChatGPT, Codex, Cursor, OpenCode, GitHub Copilot / VS Code, or another MCP host calls an agent-native app? Use [External Agents](/docs/external-agents).

## Project structure {#project-structure}

Every agent-native app — whether from a template or from scratch — follows the same structure:

```text
my-app/
  actions/         # Agent-callable actions
  app/             # Optional React frontend (routes, components, hooks)
  server/          # Nitro API server (routes, plugins)
  .agents/         # Agent instructions and skills
  data/app.db      # Local SQLite runtime state when DATABASE_URL is unset
```

Templates add domain-specific code on top: database schemas in `server/db/`, API routes in `server/routes/api/`, and actions in `actions/`. Building from scratch? See [Creating Templates](/docs/creating-templates) for `vite.config.ts`, `tsconfig.json`, and Tailwind setup.

## Architecture principles {#architecture-principles}

The three principles that apply to every agent-native app:

- **Agent + UI are equal partners** — everything the UI can do, the agent can do, and vice versa; they share the same database.
- **Everything is an action** — agent tools, UI mutations, HTTP endpoints, MCP tools, and CLI commands are all the same `defineAction()` definition.
- **All runtime state in SQL** — app state, navigation, drafts, settings, auth sessions, threads, and runs live in the database so the agent, UI, and shareable history see the same picture.

The definitive six rules are in [Key Concepts](/docs/key-concepts).

## Common next moves {#next-docs}

Once your agent is running, the usual next step is small and concrete:

- **Ask the built-in agent what it can do** — open the agent panel and type "what actions do you have, and what can you do here?" This verifies that the app-agent loop is connected.
- **Add one real action** — replace `hello` with the smallest useful operation in your domain.
- **Add UI only when it clarifies the work** — use Starter for a blank UI scaffold or a domain template for a full product surface.
- **Deploy it** — see [Deployment](/docs/deployment) when you're ready to put the app on your own domain.

Useful follow-up docs:

- [Key Concepts](/docs/key-concepts) for the architecture: SQL, actions, polling sync, and context awareness
- [Agent Surfaces](/docs/agent-surfaces) for choosing headless, rich chat, embedded sidecar, or full app
- [Workspace](/docs/workspace) for instructions, skills, memory, and per-user MCP connections
- [Messaging](/docs/messaging) for Slack, email, Telegram, and other ways to reach the agent
- [FAQ](/docs/faq) for setup and product questions
