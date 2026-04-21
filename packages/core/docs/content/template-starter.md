---
title: "Starter Template"
description: "The minimal agent-native scaffold — agent chat, actions, application state, polling, auth — wired up, with no domain code. Build from scratch."
---

# Starter

Starter is the minimum viable agent-native app. You get the six-rules architecture, the agent sidebar, the workspace tab, polling sync, auth, and exactly one example action. Nothing else. Build from there.

Pick Starter when you're not sure which domain template fits, or when you want to learn the framework by doing — there's almost nothing to delete.

## What's in it {#whats-in-it}

- **Agent sidebar** (`<AgentSidebar>`) wired into `app/root.tsx`. Chat, CLI, workspace tabs all present.
- **Agent chat plugin** pre-configured so the chat actually talks to Claude (once `ANTHROPIC_API_KEY` is set).
- **Auth** via Better Auth — login, signup, sessions, organizations. Local-mode fallback (`local@localhost`) for first-run dev.
- **Actions directory** with one example (`actions/hello-world.ts`) and the `view-screen` / `navigate` standard actions wired up.
- **Drizzle schema** with the framework's core tables (application_state, settings, oauth_tokens, sessions, resources).
- **Polling sync** (`useDbSync`) already wired so UI auto-refreshes when the agent writes to the database.
- **AGENTS.md** with the framework-wide rules the agent reads on every turn.
- **One route** at `/` that says hi and renders the sidebar toggle. That's it.

## What's _not_ in it {#not-in-it}

- No domain tables (no emails, no events, no forms)
- No fancy UI — no dashboards, no lists, no charts
- No template-specific actions beyond the stubs
- No integrations (Slack, SendGrid, etc.)

That's the point. Ship whatever belongs to _your_ app, not someone else's.

## When to pick it {#when-to-pick}

- **Building a pure-agent app** — the kind where the UI is mostly "let me see what the agent did." See [Pure-Agent Apps](/docs/pure-agent-apps).
- **Learning the framework** — this is the smallest surface to wrap your head around.
- **An internal tool** with a unique domain that doesn't match any of the other templates.
- **A prototype** — ship the agent now, add real UI later.

Pick a domain template ([Mail](/docs/template-mail), [Calendar](/docs/template-calendar), [Content](/docs/template-content), [Forms](/docs/template-forms), [Analytics](/docs/template-analytics), etc.) when there's an existing product shape that fits.

## Scaffolding {#scaffolding}

```bash
pnpm dlx @agent-native/core create my-app --template starter --standalone
```

Or, in a workspace:

```bash
pnpm dlx @agent-native/core create my-platform  # pick "Starter" (pre-selected by default) plus any others
```

## First edits {#first-edits}

After scaffolding:

1. Ask the agent: "Add a data model for `notes` — a note has an id, title, body, owner. Render a list of notes at `/notes` and let the user create one."
2. The agent adds the Drizzle schema, the `create-note` and `list-notes` actions, and the new route. You watch it happen.
3. `pnpm dev`, navigate to `/notes`, add a note through the UI. Ask the agent "draft a note summarizing yesterday's standup." Watch it use your new action.

That's the loop.

## What's next

- [**Getting Started**](/docs) — the broader CLI + workspace flow
- [**Key Concepts**](/docs/key-concepts) — the six rules and what you get for free
- [**Actions**](/docs/actions) — the action system you'll add to
- [**Adding a Feature**](/docs/key-concepts#four-area-checklist) — the four-area checklist every new feature should update
