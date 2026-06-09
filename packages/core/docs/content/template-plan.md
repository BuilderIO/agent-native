---
title: "Visual Plans"
description: "Agent-Native Plans turns your coding agent's plan into a structured, reviewable document — diagrams, wireframes, annotated code, comments, and share links. Install once from the CLI; reviewers you share with edit as a guest and sign in only to save or share."
---

# Visual Plans

Agent-Native Plans is visual plan mode for coding agents. It turns an ordinary
Codex, Claude Code, Markdown, or pasted implementation plan into a structured
review surface with rich text, diagrams, wireframes, implementation maps,
annotations, comments, and shareable links.

It comes down to two commands. `/visual-plan` builds a plan **before** the agent
writes code. `/visual-recap` turns a change that **already** happened — a PR,
commit, branch, or git diff — into a high-altitude visual code review. Both open
the same review surface, so you annotate, comment, and hand feedback back to the
agent the same way.

![Agent-Native Plans review surface](https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fdd73f749f8c54dbcb577420ab1a18788)

There are two ways into Plans:

- **From your coding agent (CLI)** — one command installs the skill, registers
  the hosted Plans connector, and authenticates it.
- **In the browser** — anyone you share with can open the editor and create or
  edit as a **guest, with no sign-up**. They sign in only when they want to save
  or share.

## Install the skill {#install}

Use the Agent-Native CLI. This is the recommended setup because it installs the
Plans skill instructions, registers the hosted Plans MCP connector, **and** runs
the client-specific auth/setup flow in one step, so your first tool call does not
hit an OAuth wall:

```bash
npx @agent-native/core@latest skills add visual-plan
```

If you already have the CLI installed, the shorter command is equivalent:

```bash
agent-native skills add visual-plan
```

The command installs both commands: `/visual-plan` and `/visual-recap`.

Authentication is a one-time browser sign-in at setup — this is intended, and it
is what lets the agent persist and share the plans it generates. What the auth
step does depends on your client:

- **OAuth-capable hosts** (Claude Code) get a URL-only MCP entry plus a prompt to
  run `/mcp` and choose **Authenticate**.
- **Codex / Cowork** run a short browser device-code flow: the CLI prints a code,
  opens the verification page, and writes the connector once you approve.
- In a **non-interactive shell or CI**, the auth step is skipped and the exact
  command to run later is printed for you.

By default the CLI targets Codex. Add `--client claude-code` or `--client all`
when you want to configure another host:

```bash
npx @agent-native/core@latest skills add visual-plan --client all
```

Pass `--no-connect` to register the connector without authenticating, then run
`agent-native connect https://plan.agent-native.com` whenever you are ready:

```bash
npx @agent-native/core@latest skills add visual-plan --no-connect
```

To auto-generate a recap on **every pull request**, pass `--with-github-action`.
This writes a GitHub Action that runs the `visual-recap` skill on each PR and
posts an interactive recap plan with an inline screenshot as a sticky comment —
see [PR Visual Recap](/docs/pr-visual-recap).

```bash
npx @agent-native/core@latest skills add visual-plan --with-github-action
```

If you only want the portable instruction file through the open Skills CLI, use:

```bash
npx skills add BuilderIO/agent-native --skill visual-plan
```

That installs the skill instructions only. It does not register the hosted MCP
connector, so use the Agent-Native CLI path when you want the one-command setup.

> **Prefer a one-install plugin?** Claude Code and Codex can add
> `BuilderIO/agent-native` directly as a plugin marketplace, which bundles the
> Plan skills _and_ the connector in one install and auto-updates as the skills
> improve — see [Plan plugin & marketplace](/docs/plan-plugin).

## Use it from your coding agent

After installation, ask your agent for the command that fits the work:

- `/visual-plan` creates a structured plan **before** implementation — for
  architecture, backend, refactor, UI, or mixed product work — pulling in
  diagrams, wireframes, mockups, clickable prototypes, and implementation maps
  as the work calls for them.
- `/visual-recap` creates a high-altitude **review** of a change that already
  happened — a PR, commit, branch, or git diff — as schema, API, file, and
  before/after blocks instead of a wall of raw diff.

The agent should inspect the codebase first, then create the visual plan when a
wrong direction would be costly. The returned Plans link opens the review UI so
you can annotate, correct, choose options, and ask for updates before code
changes begin.

When a Codex, Claude Code, Markdown, or pasted plan already exists, use
`/visual-plan`; the agent preserves that source plan and builds the richer review
surface from it instead of starting over.

If the first pass still has answerable decisions, the agent can place an
**Open Questions** form at the bottom of the same plan. Answering it and sending
it to the agent starts a revision turn against the existing plan.

## What you can do with it

- **Review before implementation.** React to diagrams, wireframes, option tabs,
  Open Questions forms, risk notes, file maps, and code previews before the
  agent edits files.
- **Comment directly on the plan.** Pin feedback to text, images, wireframes, or
  canvas locations; choose whether the comment is for the agent or a human
  reviewer; @mention teammates with inline chips; and resolve comments as the
  plan evolves.
- **Hand feedback to the agent clearly.** Text comments attach to the nearest
  prose block, visual comments include exact target metadata, and browser
  handoff includes focused screenshots for a small set of visual/canvas comment
  locations instead of one hard-to-read giant image.
- **Export the result.** Keep an HTML, Markdown, or JSON receipt of the plan
  when you need a source-control-friendly handoff.

## Editing in the browser as a guest {#guest}

People you share a plan with do not need to install anything. They open the Plans
editor and **create and edit with no sign-up** — they work as a guest. Signing in
is only required when someone wants to **save or share** their own work.

When a guest signs in, the plans they created as a guest are **claimed** into
their account, so nothing they built is lost.

Plan prose edits inline: click into any text section, type, format with the rich
editor toolbar or slash menu, and Plans autosaves the underlying markdown. Review
annotation mode temporarily turns text sections read-only so clicks can pin
feedback; leave review mode to keep editing prose.

## Sharing and commenting {#sharing}

Sharing and commenting are the workflows that need an account:

- **Viewing** a public or shared plan works for anyone with the link — no account
  required.
- **Commenting** on a shared plan requires an agent-native account.
- **Sharing** a plan (publishing it to a link, private sharing, reviewer access,
  cross-device or team review) requires signing in. Google sign-in appears when
  the standard Google OAuth env vars are configured.

The hosted Plans connector lives at `https://plan.agent-native.com/_agent-native/mcp`.
Never put shared secrets in skill files.

## Useful prompts

- "Use `/visual-plan` before changing the auth flow."
- "Create a `/visual-plan` for the new onboarding screen with mobile and desktop states."
- "Use `/visual-plan` on the Markdown plan below and make it easier to review."
- "Run `/visual-recap` on this PR so I can review the shape of the change first."
- "Use `/visual-recap` on the diff between `main` and this branch."

## Recovering from auth errors {#auth-errors}

If a Plans tool ever returns `needs auth`, `Unauthorized`, or `Session
terminated`, do not keep retrying it. Authenticate the connector with
`agent-native connect https://plan.agent-native.com` (or re-run `/mcp` →
**Authenticate** in an OAuth-capable host), then continue once the connector is
available.

## For developers

The rest of this doc is for anyone forking or self-hosting the Plans template.
Most users should install the skill with the CLI instead of scaffolding the app.

### Scaffold the template

```bash
npx @agent-native/core create my-plans --standalone --template plan
cd my-plans
pnpm install
pnpm dev
```

The hosted app-backed skill uses:

- App: `https://plan.agent-native.com`
- MCP: `https://plan.agent-native.com/_agent-native/mcp`

The local template is useful when you are developing Plans itself, testing local
persistence, or running a fully self-hosted review surface.

### Local mode (advanced, offline)

For fully offline, no-account use, you can run the Plans app locally and sync
your plans to your repo as MDX. This local mode is a separate, advanced path —
not the default hosted flow — and is best when you need everything to stay on
your machine and in version control.

## What's next

- [**PR Visual Recap**](/docs/pr-visual-recap) — run `/visual-recap` automatically on every pull request
- [**Plan plugin & marketplace**](/docs/plan-plugin) — install the Plan skills as a Claude Code or Codex plugin
- [**Skills**](/docs/skills-guide) — how Agent-Native installs skills
- [**MCP Clients**](/docs/mcp-clients) — configuring hosted MCP connectors
- [**Templates**](/docs/cloneable-saas) — the clone-and-own model
