---
title: "Plans"
description: "Install Agent-Native Plans as an app-backed skill for Codex, Claude Code, and other coding agents. Create structured visual plans with diagrams, wireframes, annotations, comments, and share links."
---

# Plans

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

## Install the skill

Use the Agent-Native CLI. This is the recommended setup because it installs the
Plans skill instructions, registers the hosted Plans MCP connector, and runs the
client-specific auth/setup flow in one step:

```bash
npx @agent-native/core@latest skills add visual-plan
```

If you already have the CLI installed, the shorter command is equivalent:

```bash
agent-native skills add visual-plan
```

The command installs both commands: `/visual-plan` and `/visual-recap`.

Use `/visual-plan` for both fresh plans and existing Codex, Claude Code,
Markdown, or pasted plans; when source plan text already exists, the agent builds
from that plan instead of starting over. Use `/visual-recap` to review a change
that already landed instead of writing one up by hand.

By default the CLI targets Codex. Add `--client claude-code` or `--client all`
when you want to configure another host:

```bash
npx @agent-native/core@latest skills add visual-plan --client all
```

If you only want the portable instruction file through the open Skills CLI, use:

```bash
npx skills add BuilderIO/agent-native --skill visual-plan
```

That installs the skill instructions only. It does not register the hosted MCP
connector, so use the Agent-Native CLI path when you want the one-command setup.

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
- **Share with reviewers.** Hosted Plans can create private review links and
  account-backed sharing. Viewing shared plans works from the browser; saving
  and sharing require sign-in.
- **Export the result.** Keep an HTML, Markdown, or JSON receipt of the plan
  when you need a source-control-friendly handoff.
- **Run locally when needed.** The template can be self-hosted for development
  or offline workflows, while the hosted skill is the easiest path for normal
  coding-agent use.

## Useful prompts

- "Use `/visual-plan` before changing the auth flow."
- "Create a `/visual-plan` for the new onboarding screen with mobile and desktop states."
- "Use `/visual-plan` on the Markdown plan below and make it easier to review."
- "Run `/visual-recap` on this PR so I can review the shape of the change first."
- "Use `/visual-recap` on the diff between `main` and this branch."

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

## What's next

- [**Visual Plans**](/docs/visual-plans) — the full skill flow and auth details
- [**PR Visual Recap**](/docs/pr-visual-recap) — run `/visual-recap` automatically on every pull request
- [**Skills**](/docs/skills-guide) — how Agent-Native installs skills
- [**MCP Clients**](/docs/mcp-clients) — configuring hosted MCP connectors
- [**Templates**](/docs/cloneable-saas) — the clone-and-own model
