---
title: "Visual Plans"
description: "Agent-Native Plans turns your coding agent's plan into a structured, reviewable document — diagrams, wireframes, annotated code, comments, and share links. Install once from the CLI; reviewers you share with edit as a guest and sign in only to save or share."
---

# Visual Plans

Agent-Native Plans is visual plan mode for coding agents. It turns an ordinary
Codex, Claude Code, Markdown, or pasted implementation plan into a structured
review surface with rich text, diagrams, wireframes, annotated code walkthroughs
and file trees, annotations, comments, and shareable links.

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

If you are using a chat-based host that accepts MCP connector URLs directly
(rather than a CLI-configured client), connect the hosted Plans connector at
`https://plan.agent-native.com/_agent-native/mcp` — see [MCP Clients](/docs/mcp-clients) for client-specific setup.

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

After the workflow is written, run `agent-native recap setup` to configure
GitHub Actions secrets/variables where possible and `agent-native recap doctor`
to verify the repo is ready.

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
  diagrams, wireframes, mockups, clickable prototypes, and annotated code
  walkthroughs and file trees as the work calls for them.
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
  Open Questions forms, risk notes, annotated code walkthroughs, and code
  previews before the agent edits files.
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

## Local-files privacy mode {#local-files}

For privacy-focused work, ask for local-files mode:

```text
Use /visual-plan in local-files mode. Do not write this plan to the Plan DB.
```

or set the convention for your agent environment:

```bash
export AGENT_NATIVE_PLANS_MODE=local-files
```

In this mode the agent writes a local MDX folder under `plans/<slug>/` and must
not call the hosted Plan MCP tools. The durable files are:

- `plan.mdx`
- optional `canvas.mdx`
- optional `prototype.mdx`
- optional `.plan-state.json`

After writing the folder, the agent validates and previews it locally:

```bash
agent-native plan local preview --dir plans/<slug> --kind plan
```

If you run the Plan app locally with the same `PLAN_LOCAL_DIR`, you can open the
read-only app route:

```text
http://localhost:<port>/local-plans/<slug>
```

Local-files mode prevents plan or recap content from going to the Agent-Native
Plan database. It also disables hosted sharing, browser comments, plan history,
and publish/export receipts until you explicitly opt into publishing. To move a
local plan into the hosted database, call `publish-visual-plan` with the local
MDX folder path; this uploads the plan, assigns it a hosted ID, enables sharing
and commenting, and returns the hosted URL. It does
not automatically make your coding agent's LLM local; choose a local or approved
model if that privacy boundary matters too.

## Useful prompts

- "Use `/visual-plan` before changing the auth flow."
- "Create a `/visual-plan` for the new onboarding screen with mobile and desktop states."
- "Use `/visual-plan` on the Markdown plan below and make it easier to review."
- "Run `/visual-recap` on this PR so I can review the shape of the change first."
- "Use `/visual-recap` on the diff between `main` and this branch."
- "Use `/visual-recap` in local-files mode so no recap content is written to the Plan DB."

## Recovering from auth errors {#auth-errors}

If a Plans tool ever returns `needs auth`, `Unauthorized`, or `Session
terminated`, do not keep retrying it. Authenticate the connector with
`agent-native connect https://plan.agent-native.com` (or re-run `/mcp` →
**Authenticate** in an OAuth-capable host), then continue once the connector is
available.

## For developers

The rest of this doc is for anyone forking or self-hosting the Plans template.
Most users should install the skill with the CLI instead of scaffolding the app.

### Quick start

```bash
npx @agent-native/core create my-plans --standalone --template plan
cd my-plans
pnpm install
pnpm dev
```

The hosted app-backed skill uses:

- App: `https://plan.agent-native.com`
- MCP: `https://plan.agent-native.com/_agent-native/mcp`

The local template is useful when you are developing Plans itself, testing local persistence, or running a fully self-hosted review surface.

### Data model

Schema lives in `templates/plan/server/db/schema.ts`. Core tables:

| Table              | What it holds                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `plans`            | Each plan or recap — `title`, `brief`, `kind` (plan/recap), `status`, `source`, `html`/`markdown`/`content`, `hosted_plan_id/url`, usage stats, `source_url` |
| `plan_sections`    | Ordered sections within a plan — `type`, `title`, `body`, `html`, `sort_order`, `created_by`                                                                 |
| `plan_comments`    | Threaded comments — `kind`, `status`, `anchor`, `message`, `resolution_target`, `mentions_json`, `resolved_by`                                               |
| `plan_events`      | Audit log of agent/human events on a plan                                                                                                                    |
| `plan_versions`    | Point-in-time snapshots for version history                                                                                                                  |
| `plan_shares`      | Per-principal share grants (viewer / editor / admin)                                                                                                         |
| `plan_guest_mints` | Rate-limit records for guest session issuance                                                                                                                |
| `plan_assets`      | Inline image assets stored as base64 (fallback when no upload provider)                                                                                      |

### Key actions

Actions in `templates/plan/actions/`:

- **Creation** — `create-visual-plan`, `create-visual-recap`, `create-ui-plan`, `create-prototype-plan`, `create-plan-design`, `create-visual-questions`
- **Reading & editing** — `get-visual-plan`, `update-visual-plan`, `list-visual-plans`, `import-visual-plan-source`, `patch-visual-plan-source`, `read-visual-plan-source`, `export-visual-plan`
- **Publishing & sharing** — `publish-visual-plan`
- **Versions** — `list-plan-versions`, `get-plan-version`, `restore-plan-version`
- **Comments & feedback** — `get-plan-feedback`, `reply-to-plan-comment`, `resolve-plan-comment`, `consume-plan-feedback`
- **Prototype** — `convert-visual-plan-to-prototype`, `create-prototype-plan`
- **Context & navigation** — `view-screen`, `navigate`

### Route map

- `app/routes/plans.$id.tsx` — plan editor / review surface
- `app/routes/plans._index.tsx` — plan list
- `app/routes/share.$token.tsx` — public / shared plan view
- `app/routes/local-plans.$slug.tsx` — local-files mode preview

### Local mode (advanced, offline) {#local-mode}

For fully offline, no-account use, you can run the Plans app locally and point it at local MDX folders. For the stricter no-DB path, use [local-files privacy mode](#local-files), which reads from MDX folders instead of creating local SQL rows. Local mode is a separate, advanced path — not the default hosted flow.

## Events and notifications {#events}

The Plan template emits four events on the framework event bus. Any automation
can subscribe to them — no custom integration code needed.

### Event reference {#event-reference}

#### `plan.created`

Fires when a new visual plan or recap is created.

| Field       | Type                  | Description                              |
| ----------- | --------------------- | ---------------------------------------- |
| `planId`    | string                | Unique plan identifier                   |
| `title`     | string                | Plan title                               |
| `kind`      | `"plan"` \| `"recap"` | Whether this is a plan or a recap        |
| `status`    | string                | Initial status (e.g. `"review"`)         |
| `path`      | string                | App-relative path (e.g. `/plans/plan-…`) |
| `createdBy` | string                | Always `"agent"` for plan creation       |

#### `plan.commented`

Fires when one or more comments are added to a plan.

| Field              | Type                             | Description                                                 |
| ------------------ | -------------------------------- | ----------------------------------------------------------- |
| `planId`           | string                           | Plan identifier                                             |
| `title`            | string                           | Plan title                                                  |
| `kind`             | `"plan"` \| `"recap"`            | Plan or recap                                               |
| `commentIds`       | string[]                         | IDs of the new comments                                     |
| `commentCount`     | number                           | Number of new comments in this batch                        |
| `resolutionTarget` | `"agent"` \| `"human"` \| `null` | Dominant target — `"agent"` if any comment targets an agent |
| `excerpt`          | string                           | First 200 characters of the first comment                   |
| `author`           | string \| null                   | Email of the commenter, if known                            |
| `path`             | string                           | App-relative path                                           |

#### `plan.published`

Fires when a local plan is published (or re-published) to a hosted shareable URL.

| Field                 | Type                  | Description                        |
| --------------------- | --------------------- | ---------------------------------- |
| `planId`              | string                | Local plan identifier              |
| `title`               | string                | Plan title                         |
| `kind`                | `"plan"` \| `"recap"` | Plan or recap                      |
| `hostedPlanId`        | string                | Hosted plan identifier             |
| `url`                 | string                | Full public URL of the hosted plan |
| `requestedVisibility` | string                | `"public"`, `"private"`, etc.      |

#### `plan.status.changed`

Fires when a plan's status changes (e.g. `review` → `approved`).

| Field       | Type                  | Description                        |
| ----------- | --------------------- | ---------------------------------- |
| `planId`    | string                | Plan identifier                    |
| `title`     | string                | Plan title                         |
| `kind`      | `"plan"` \| `"recap"` | Plan or recap                      |
| `oldStatus` | string \| null        | Previous status                    |
| `newStatus` | string                | New status                         |
| `changedBy` | string \| null        | Email of the person who changed it |
| `path`      | string                | App-relative path                  |

### Automation recipes {#automation-recipes}

These automations are created by asking the plan agent — no code changes needed.
The agent calls `manage-automations` with `action=define`, writes a
`jobs/<name>.md` resource, and the event subscription starts immediately.

#### Notify via webhook when someone comments on a plan

Ask the plan agent:

> "When someone adds a human comment on a plan, POST a message to my webhook."

The agent creates an automation like this:

```yaml
---
triggerType: event
event: plan.commented
condition: "resolutionTarget is human or resolutionTarget is null"
mode: agentic
domain: plan
enabled: true
---
Send a POST request to ${keys.NOTIFY_WEBHOOK} with a JSON body containing:
  - "title": the plan title from the event payload
  - "excerpt": the comment excerpt from the event payload
  - "url": the base app URL concatenated with the path field from the event payload
  - "author": the author field from the event payload (may be null)
```

Before the automation can fire you need to add the webhook URL as an ad-hoc key:

1. Go to **Settings → Keys** and add a key named `NOTIFY_WEBHOOK` with your
   webhook URL (e.g. a Slack incoming webhook, a generic HTTP endpoint, or any
   notification service URL).
2. Optionally set a URL allowlist on the key to restrict which origins it can
   POST to.

The `web-request` tool resolves `${keys.NOTIFY_WEBHOOK}` server-side before
sending — the raw URL never appears in the agent's context.

**To target Slack specifically:** set `NOTIFY_WEBHOOK` to your Slack incoming
webhook URL
(`https://hooks.slack.com/services/…`). The automation body above already
produces a payload Slack's incoming webhook accepts via the `text` or `blocks`
fields — ask the agent to format the body as a Slack message if you want richer
formatting.

#### Wake the coding agent when feedback targets it

For feedback directed at the coding agent (`resolutionTarget === "agent"`), ask:

> "When a plan comment targets the agent, run my coding agent with the plan
> excerpt as context."

```yaml
---
triggerType: event
event: plan.commented
condition: "resolutionTarget is agent"
mode: agentic
domain: plan
enabled: true
---

Use the manage-notifications action or web-request tool to alert the coding agent
that new agent-targeted feedback has arrived on plan ${planId}: "${excerpt}".
Include the plan path so the agent can navigate directly to it.
```

Because the automation runs a full agent loop (`mode: agentic`), it can call
`web-request`, send notifications, or invoke any action the agent has access to.
The exact delivery mechanism depends on what notification channels you have
configured — the agent picks the best available one.

## What's next

- [**PR Visual Recap**](/docs/pr-visual-recap) — run `/visual-recap` automatically on every pull request
- [**Automations**](/docs/automations) — event-triggered and scheduled automations
- [**Plan plugin & marketplace**](/docs/plan-plugin) — install the Plan skills as a Claude Code or Codex plugin
- [**Skills**](/docs/skills-guide) — how Agent-Native installs skills
- [**MCP Clients**](/docs/mcp-clients) — configuring hosted MCP connectors
- [**Templates**](/docs/cloneable-saas) — the clone-and-own model
