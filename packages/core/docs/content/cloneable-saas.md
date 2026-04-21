---
title: "Cloneable SaaS"
description: "Agent-native templates are not demos — they're complete, SaaS-grade products you clone, customize, and own."
---

# Cloneable SaaS

The word "template" undersells what ships with agent-native.

In most frameworks, a template is a bare-bones scaffold: a couple of routes, a few components, and a lot of "TODO." Agent-native inverts that. Every template is a **full, SaaS-grade product** — email client, calendar, analytics, deck generator, video editor, form builder, issue tracker — complete enough to use as-is, and also complete enough to fork and make your own.

Think of them less like "templates" and more like **cloneable SaaS**. You get a real product, not a starting point.

## The pitch {#pitch}

Every SaaS product you use today hits the same wall: it gives you 80% of what you need, and you can't change the 20% that really matters. You can't touch the data model. You can't add the metric. You can't wire it to your internal system. You can't give it instructions.

Cloneable SaaS flips that. You start from a production-quality app, and everything about it is yours — the code, the database, the agent, the deploy target, the brand. If you don't like how the inbox groups by thread, change it. If you need a field that the template doesn't have, add it. The agent helps you do all of this in natural language.

This isn't a theoretical claim: it's how Steve (the framework's author) has been using it for months. The mail template _is_ his inbox. The analytics template _is_ his dashboard. The calendar template _is_ his calendar.

## What's in the catalog {#catalog}

All of these ship in the `BuilderIO/agent-native` repo and scaffold via `agent-native create`:

| Template       | What it is                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| **Mail**       | An agent-native Superhuman. Inbox, labels, AI triage, keyboard-first, with an agent that can draft and send.    |
| **Calendar**   | An agent-native Google Calendar. Events, sync, public booking links, agent-driven scheduling.                   |
| **Content**    | An agent-native Notion / Google Docs. Markdown + Tiptap editor, Notion sync, multi-user real-time collab.       |
| **Slides**     | An agent-native Google Slides. React-based decks the agent generates and edits directly.                        |
| **Video**      | An agent-native video editor built on Remotion. Prompt for a cut, the agent assembles it.                       |
| **Analytics**  | An agent-native Amplitude/Mixpanel. Connect data sources, prompt for charts, pin to dashboards.                 |
| **Forms**      | An agent-native Typeform. Build, share, and collect; agent handles the schema and analysis of submissions.      |
| **Issues**     | An agent-native Jira. Projects, issues, priorities, with the agent as your project manager.                     |
| **Recruiting** | An agent-native Greenhouse. Candidate pipelines, scoring, outreach drafts.                                      |
| **Dispatch**   | The **workspace control plane**: central secrets vault, cross-app integrations, Slack/Telegram, scheduled jobs. |
| **Starter**    | The minimal scaffold. Agent chat + the six-rules architecture wired up, nothing else. Build from scratch.       |

Additional templates in active development in the repo: **Clips** (screen recording + transcription), **Calls** (Gong-style conversation intelligence), **Scheduling** (a standalone scheduling app and reusable package).

## The clone → customize → deploy flow {#flow}

Every cloneable SaaS follows the same lifecycle:

### 1. Clone

```bash
pnpm dlx @agent-native/core create my-platform
```

The CLI shows a multi-select picker. Pick one app (standalone) or several (workspace — apps share auth, brand, agent config, and database). Each picked template is scaffolded into `apps/<name>/` with every file you need. See [Getting Started](/docs) for the full flow or [Enterprise Workspace](/docs/enterprise-workspace) for the workspace story.

### 2. Use it immediately

Every template is runnable the moment it scaffolds. Fill in `.env` (mostly `ANTHROPIC_API_KEY` and `DATABASE_URL`), `pnpm install`, `pnpm dev`, and it works. No "TODO: implement login," no placeholder routes.

### 3. Customize with the agent

The agent can modify code — components, routes, actions, styles, the schema. This is a feature, not a bug:

- "Change the inbox to group by sender instead of thread." _The agent edits the component._
- "Add a `leadScore` column to contacts and compute it from the last email." _The agent adds the Drizzle column, runs a migration, writes the scoring action._
- "Connect this to our internal HR API." _The agent writes the integration._

Every edit is normal Git-tracked code. Bad changes? Revert them. Good changes? Keep them. See [Self-Modifying Code](/docs/key-concepts#agent-modifies-code) for the full mental model.

### 4. Deploy anywhere

Agent-native apps run on any Nitro-compatible host (Node, Cloudflare, Netlify, Vercel, Deno, Lambda, Bun) and any Drizzle-compatible SQL database (SQLite, Postgres, Turso, D1, Supabase, Neon). The framework doesn't lock you in.

For workspaces, `agent-native deploy` builds every app at once and ships them behind a single origin — your own domain, your own cert, one command. See [Deployment](/docs/deployment).

### 5. Stay on `agent-native.com`, or self-host

You can also use these as hosted apps on the Builder-operated `agent-native.com` platform — `mail.agent-native.com`, `calendar.agent-native.com`, etc. — without forking. Fork only when you want to change something the hosted version doesn't let you change.

## Why this works {#why-this-works}

Cloneable SaaS wouldn't be practical in a traditional codebase. Every user forking their own inbox would mean every user maintaining their own inbox — no thanks.

Two framework decisions unlock it:

1. **Agents do the maintenance.** You don't write code to add a column or wire a new integration — you ask the agent. So "your own forked inbox" is a feature, not a burden, because the agent is doing the work.
2. **The workspace is SQL, not files.** Every user gets their own customization layer (skills, memory, instructions, connected MCP servers, sub-agents) without a dev-box. The shared codebase hosts all of them at once. See [Workspace](/docs/workspace).

Combined, you get Claude-Code-level flexibility per user, with SaaS-grade deployment economics.

## Authoring your own cloneable SaaS {#authoring}

Want to publish a new template — your own cloneable SaaS? See [Creating Templates](/docs/creating-templates). You can publish to `BuilderIO/agent-native` for inclusion in the CLI picker, or host elsewhere and scaffold with `--template github:user/repo`.

## What's next

- [**Enterprise Workspace**](/docs/enterprise-workspace) — bundle many cloneable-SaaS apps into one monorepo that shares auth, brand, and agent instructions
- [**Key Concepts**](/docs/key-concepts) — the architecture that makes this work
- [**Deployment**](/docs/deployment) — ship your forked app
- [**Creating Templates**](/docs/creating-templates) — author and publish a new cloneable SaaS
