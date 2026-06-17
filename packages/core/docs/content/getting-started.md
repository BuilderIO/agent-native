---
title: "Getting Started"
description: "Pick a template, create your app, and start customizing it with AI."
---

# Getting Started

By the end of this page, you'll have a working app — Mail, Calendar, Forms, or any other template — running with an AI agent built into the sidebar that can drive every part of it.

## Who is this for? {#who-is-this-for}

There are two ways to use agent-native, depending on how hands-on you want to be:

- **You want to use a hosted version.** Try a template right now at [agent-native.com/templates](/templates). Each template is a live, hosted app — you sign in, start using it, and the agent is already there. No install, no setup. You can stop reading this page and head straight to the [template gallery](/templates).
- **You want to run locally or customize it.** You'll clone a template, run it on your machine, and shape it however you want — branding, features, integrations. The rest of this page is for you. You'll need [Node.js 22 or newer (LTS recommended)](https://nodejs.org) and [pnpm](https://pnpm.io) installed.
- **You just want to add agent-native to your existing coding agent.** Skip the scaffold entirely — install a skill into Claude Code, Codex, or Cursor with one command. Jump to [Try it with a skill](#try-with-a-skill).
- **You want your existing agent to call an agent-native app.** Connect Claude, ChatGPT, Codex, Cursor, OpenCode, GitHub Copilot / VS Code, or another MCP host through [External Agents](/docs/external-agents).

Not sure which path? If you've never written code, the hosted version is for you. If you have a developer or AI coding tool ready, the local path gives you total control.

## First run {#create-your-app}

Three commands and you're up:

```bash
npx @agent-native/core@latest create my-platform
cd my-platform
pnpm install && pnpm dev
```

The `create` command defaults to a workspace monorepo. It shows a multi-select picker — pick one template or several (Mail + Calendar + Forms, for example) and they all scaffold into one workspace sharing auth, brand, and agent config. If you want one app directory instead, pass `--standalone`.

Open the URL the dev server prints. The workspace gateway always starts on port 8080 and serves every app through it; individual apps run on their own ports that are printed at startup. Standalone apps default to `http://localhost:3000`.

### Agent credentials {#agent-credentials}

In local development the embedded agent panel picks up your existing Claude Code or Codex CLI login automatically, or reads `ANTHROPIC_API_KEY` from a `.env` file in the project root. The database defaults to SQLite (stored at `data/app.db`) when `DATABASE_URL` is not set, so you can run the full stack with no external services. For production deployments — where you'll want Postgres, a persistent secret, and bring-your-own-key per user — see [Deployment](/docs/deployment).

## What just happened? {#what-just-happened}

You now have a real, full-featured app running on your machine. Open it in the browser and try it:

- Click around the UI like you would any SaaS product.
- Open the agent panel on the right side. Type something like "show me my settings" or "create a new entry called Welcome." Watch the agent click through the app on your behalf.
- Anything you do by clicking, the agent can do by reading and writing the same database. Anything the agent does shows up in the UI immediately.

That parity between agent and UI is the whole point — see [What Is Agent-Native?](/docs/what-is-agent-native) for the bigger picture.

## Templates {#templates}

Each template is a complete app with UI, agent actions, database schema, and AI instructions ready to go:

| Template                              | What it is                                                            |
| ------------------------------------- | --------------------------------------------------------------------- |
| [Calendar](/docs/template-calendar)   | Agent-native Google Calendar + Calendly-style booking                 |
| [Content](/docs/template-content)     | Open-source Obsidian for MDX                                          |
| [Brain](/docs/template-brain)         | Company chat with cited institutional memory                          |
| [Assets](/docs/template-assets)       | Brand asset libraries and generated media                             |
| [Slides](/docs/template-slides)       | Agent-native Google Slides / Pitch                                    |
| [Video](/docs/template-videos)        | Programmatic motion graphics and product-demo videos on Remotion      |
| [Analytics](/docs/template-analytics) | Agent-native Amplitude / Mixpanel                                     |
| [Mail](/docs/template-mail)           | Agent-native Superhuman / Gmail                                       |
| [Clips](/docs/template-clips)         | Async screen + camera recording with transcription and AI summaries   |
| [Design](/docs/template-design)       | Agent-native HTML prototyping studio                                  |
| [Forms](/docs/template-forms)         | Agent-native Typeform                                                 |
| [Plan](/docs/template-plan)           | Visual plans and PR recaps with diagrams, wireframes, and annotations |
| [Dispatch](/docs/template-dispatch)   | Workspace control plane — shared secrets, integrations, routing       |

Browse the [template gallery](/templates) for live demos, or see [Templates](/docs/cloneable-saas) for the full catalog and the clone → customize → deploy flow.

## Creating vs adding apps {#creating-vs-adding-apps}

Run `create` from the folder where you want a brand-new workspace:

```bash
cd ~/projects
npx @agent-native/core@latest create my-platform
```

After a workspace exists, run app commands from the workspace root:

```bash
cd my-platform
npx @agent-native/core@latest add-app
pnpm install
pnpm dev
```

If your terminal is inside `apps/content` or another app folder, the CLI still detects the workspace and adds the new app as a sibling under `apps/`. Afterward, go back to the workspace root before running `pnpm install` or `pnpm dev`.

To make a second app from the same template, give it a new app name:

```bash
npx @agent-native/core@latest add-app design-lab --template design
```

## Try it with a skill {#try-with-a-skill}

Don't want to scaffold a whole app yet? Add agent-native superpowers to a coding agent you already use — Claude Code, Codex, or Cursor — with a single command. Installing the **Plans** skill turns the plans your agent writes into structured, reviewable docs with diagrams, wireframes, and inline comments:

```bash
npx @agent-native/core@latest skills add visual-plan
```

That one command installs the skill instructions, registers the hosted MCP connector, and signs you in — no marketplace browsing, no manual OAuth. Then run `/visual-plan` in your agent. See the [Skills Guide](/docs/skills-guide#app-backed-skills) for more skills, local/offline installs, and how app-backed skills work.

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

## Next docs to read {#next-docs}

Once your app is running, the most useful follow-ups are:

- **Connect Slack or email** so you can message your agent from anywhere — see [Messaging](/docs/messaging).
- **Set up Dispatch as your central inbox** to triage messages and orchestrate across multiple apps — see [Dispatch](/docs/dispatch).
- **Customize via Workspace** — edit instructions, skills, memory, and connect MCP servers per user — see [Workspace](/docs/workspace).
- **Troubleshoot common setup questions** — see the [FAQ](/docs/faq).
- **Understand the architecture** — see [Key Concepts](/docs/key-concepts) for how SQL, actions, polling sync, and context awareness fit together.

## Try one concrete next step {#first-next-step}

From here, use any AI coding tool (Agent-Native Code, Claude Code, Cursor, Windsurf, Builder.io) to customize the app. The agent instructions in `AGENTS.md` are already set up so any tool understands the codebase.

Good first moves:

- **Open Agent-Native Code** — run `npx @agent-native/core@latest` or `npx @agent-native/core@latest code` from the project. A bare command opens the local Claude Code/Codex-like workspace; a bare prompt such as `npx @agent-native/core@latest "rename the app"` starts a Code task directly.
- **Ask the built-in agent what it sees** — open the agent panel and type "what app am I looking at, and what can you do here?" This verifies the app, UI state, and agent loop are all talking to each other.
- **Make a tiny customization** — ask your coding tool to rename the app, change the first screen copy, or add one field to a form. It will read `AGENTS.md` for the framework conventions.
- **Add another app to the same workspace** — use `npx @agent-native/core@latest add-app` from inside the workspace folder. The command starts at `npx`.
- **Single app instead of a monorepo?** Pass `--standalone` when creating: `npx @agent-native/core@latest create my-app --standalone --template mail`.

Agent-Native Code understands built-in slash goals such as `/migrate` and `/audit`, plus project commands in `.agents/commands/*.md`. Use `npx @agent-native/core@latest code list`, `status`, `resume`, `stop`, or `ui` to inspect and control the same run from the CLI, the local UI, or the Desktop Code tab.

## Architecture principles {#architecture-principles}

The three principles that apply to every agent-native app:

- **Agent + UI are equal partners** — everything the UI can do, the agent can do, and vice versa; they share the same database.
- **Everything is an action** — agent tools, UI mutations, HTTP endpoints, MCP tools, and CLI commands are all the same `defineAction()` definition.
- **All state in SQL** — app state, navigation, drafts, and settings live in the database so both agent and UI always see the same picture.

The definitive six rules are in [Key Concepts](/docs/key-concepts).

## Testing local framework changes {#testing-local-framework-changes}

Framework contributors can scaffold against the current checkout instead of the
published packages:

```bash
AGENT_NATIVE_CREATE_USE_LOCAL_CORE=1 pnpm --filter @agent-native/core create my-platform
```

With that flag, generated workspaces link both the local `@agent-native/core`
and local `@agent-native/dispatch` packages. Use it when you need to verify
unpublished template or package changes end-to-end in a freshly generated
workspace. The packages run their `prepack` build first, so the linked packages
serve fresh `dist` output instead of stale build artifacts.

To exercise the repo-local CLI itself without building first, run it through
the root script:

```bash
pnpm dev:cli --help
pnpm dev:cli code goals
```
