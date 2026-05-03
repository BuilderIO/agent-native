---
title: "Cloneable SaaS"
description: "Fork a working SaaS product and make it yours — agent included."
---

# Cloneable SaaS

Want to ship your own AI-powered analytics tool? Mail client? Forms builder? Pick a template, and you've got a working SaaS in minutes — agent, database, auth, and deploy pipeline already wired up.

Most templates give you a blank scaffold and a long TODO list. Agent-native flips that. Each template is a **complete, SaaS-grade product** — already runnable on day one, already shippable, and entirely yours to customize, brand, and deploy.

We call them **cloneable SaaS**, not templates. You're not starting from scratch. You're forking a finished product.

## Templates available {#catalog}

Each one is a real app you could use today, and the launching pad for your own version of it.

| Template      | What it is                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| **Mail**      | An agent-native Superhuman. Inbox, labels, AI triage, keyboard-first, drafts and sends through the agent.      |
| **Calendar**  | An agent-native Google Calendar. Events, sync, public booking links, agent-driven scheduling.                  |
| **Content**   | An agent-native Notion / Google Docs. Markdown + Tiptap editor, Notion sync, real-time multi-user collab.      |
| **Slides**    | An agent-native Google Slides. React-based decks the agent generates and edits directly.                       |
| **Video**     | An agent-native video editor on Remotion. Prompt for a cut, the agent assembles it.                            |
| **Analytics** | An agent-native Amplitude/Mixpanel. Connect data sources, prompt for charts, pin to dashboards.                |
| **Clips**     | An agent-native Loom. Async screen + camera recording with transcription, chapters, AI summaries.              |
| **Design**    | Agent-native HTML prototyping studio for interactive Alpine/Tailwind designs.                                  |
| **Forms**     | An agent-native Typeform. Build, share, collect, and route submissions to Slack, Sheets, webhooks, or Discord. |
| **Dispatch**  | The workspace control plane: shared secrets, cross-app integrations, Slack/Telegram, scheduled jobs.           |
| **Starter**   | The minimal scaffold. Agent chat plus the architecture, nothing else. Build something new.                     |

See the full catalog under [Templates](/templates), or jump straight to one — for example, [Dispatch](/docs/template-dispatch) is a great place to start if you want a workspace-style app.

## What you get out of the box {#what-you-get}

Every cloneable SaaS ships with the parts that normally take months to build:

- **A working agent** — already wired into the app, already able to take actions on your data, already context-aware about what you're looking at. See [Messaging the agent](/docs/messaging) for how it works.
- **Auth** — sign in, sessions, organizations, multi-tenant isolation. Already done.
- **A database** — every template has its schema, queries, and migrations ready to go. Bring your own SQL database (Postgres, SQLite, Turso, D1) — the framework adapts.
- **A real-time UI** — the screen stays in sync with what the agent does. Click "draft an email" in chat, watch the draft appear in your inbox immediately.
- **Deploy-ready** — push to Netlify, Vercel, Cloudflare, AWS, or anywhere else that runs Node. No vendor lock-in.
- **Branding hooks** — name, colors, logo, copy are all easy to change.

This isn't a theoretical claim. The framework's author runs his actual inbox on the Mail template, his actual calendar on the Calendar template, and his actual analytics on the Analytics template. Templates are daily-driver software.

## What you do {#what-you-do}

The path from "I want my own SaaS" to "I have my own SaaS" is short:

1. **Pick a template.** Use the CLI picker, or browse the docs and pick one to start from.
2. **Brand it.** Change the name, colors, logo, and copy. Most templates expose this in a single config file.
3. **Customize it.** Ask the agent to add the column you need, change how the inbox groups, connect to your internal API, add a new view. The agent edits the code; you review the diff.
4. **Ship it.** Run the deploy command. You now have your own production SaaS at your own domain.

Steps 2–4 typically take days, not months. Step 3 is open-ended — your forked SaaS evolves over time, in plain English, by talking to the agent.

## Why this is practical {#why}

A traditional fork-the-codebase model breaks down at scale: every user maintaining their own inbox sounds like a maintenance nightmare. Two framework decisions make it work:

1. **The agent does the maintenance.** You don't write code to add a column or wire a new integration — you ask the agent. So "your own forked inbox" is a feature, not a burden.
2. **Per-user customization without per-user code.** Skills, memory, instructions, connected MCP servers, and sub-agents all live in SQL. Every user gets their own customization layer; the shared codebase hosts all of them at once.

The result: Claude-Code-level flexibility for each user, with normal SaaS deployment economics.

## Don't want to fork? {#hosted}

You don't have to. Every template is also available as a hosted app on `agent-native.com` — `mail.agent-native.com`, `calendar.agent-native.com`, and so on. Use the hosted version for free or paid; fork only when you want to change something the hosted version doesn't expose.

## Building on this

- [**Getting Started**](/docs/getting-started) — clone your first template and run it locally
- [**Messaging the agent**](/docs/messaging) — how users (and you) talk to the agent that ships with each template
- [**Multi-App Workspace**](/docs/multi-app-workspace) — bundle several cloneable-SaaS apps into one workspace that shares auth, brand, and agent
- [**Dispatch**](/docs/template-dispatch) — the workspace control plane template
- [**Creating Templates**](/docs/creating-templates) — author and publish your own cloneable SaaS

### For developers {#dev-details}

If you're scaffolding now, the CLI command is:

```bash
pnpm dlx @agent-native/core create my-platform
```

You'll get a multi-select picker. Pick one app (standalone) or several (workspace — apps share auth, brand, agent config, and database). Each picked template is scaffolded into `apps/<name>/` with every file you need.

Fill in `.env` (mostly `ANTHROPIC_API_KEY` and `DATABASE_URL`), `pnpm install`, `pnpm dev`, and it works. No "TODO: implement login," no placeholder routes.

Deploy targets: any Nitro-compatible host (Node, Cloudflare, Netlify, Vercel, Deno, Lambda, Bun) and any Drizzle-compatible SQL database (SQLite, Postgres, Turso, D1, Supabase, Neon). For workspaces, `agent-native deploy` builds every app at once and ships them behind a single origin. See [Deployment](/docs/deployment).

To author and publish your own cloneable SaaS, see [Creating Templates](/docs/creating-templates).
