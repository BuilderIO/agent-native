---
title: "Workspace"
description: "Claude-Code-level customization per user — skills, memory, instructions, custom agents, scheduled jobs, MCP servers — backed by SQL, not a filesystem."
---

# Workspace

> **See also:** Deploying multiple apps as one workspace? See [Multi-App Workspaces](/docs/multi-app-workspace). Governance, branching, and CODEOWNERS? See [Workspace Governance](/docs/workspace-management).

Every agent-native app ships with a **workspace**: the customization layer that makes the agent yours. It contains team instructions (`AGENTS.md`), shared learnings (`LEARNINGS.md`), personal structured memory (`memory/MEMORY.md`), skills the agent pulls in on demand, custom sub-agents, scheduled jobs, and connected MCP servers — everything you'd expect from a Claude Code / Codex setup.

The twist: **it's SQL rows, not filesystem files.** Each user gets their own workspace stored in the database. There's no dev-box to spin up, no container per user, no files to mount. A multi-tenant SaaS can give every user a fully-customizable agent for essentially free, because all of it is rows — personal memory, personal MCP servers, personal skills, personal sub-agents — and the shared codebase hosts all of them at once.

| Claude Code / Codex              | Agent-native workspace                             |
| -------------------------------- | -------------------------------------------------- |
| Files on your local disk         | Rows in a shared SQL database                      |
| One codebase per developer       | One codebase, many users                           |
| Needs a dev-box or container     | Runs on any serverless/edge host                   |
| Customization at `~/.claude/`    | Customization per-user, scoped `u:<email>:…`       |
| Per-project `CLAUDE.md` / skills | Per-app `AGENTS.md` + workspace memory resources   |
| MCP config in a JSON file        | MCP config in JSON _or_ the settings UI, per scope |

Same capabilities. Different economics. See [Templates](/docs/cloneable-saas) for why this matters for SaaS.

## Overview {#overview}

Resources have three runtime scopes:

- **Personal** — scoped to a single user (their email). Good for preferences, notes, and per-user context.
- **Shared / organization** — visible to all users in the app or organization. Good for app/team instructions, skills, and shared config.
- **Workspace** — inherited global defaults managed from Dispatch Resources. Good for company facts, positioning, brand guidelines, global guardrails, workspace-wide skills, and shared MCP servers. Apps read these at runtime; they are not copied into each app.

The in-app Workspace panel shows all three scopes. Personal and shared/organization resources are editable there. Workspace-scope resources are read-only in app panels and edited centrally from Dispatch, so every app sees the same canonical files without a sync step.

The canonical paths that control how the agent uses each resource:

| Runtime resource        | Path                                    | How agents use it                               |
| ----------------------- | --------------------------------------- | ----------------------------------------------- |
| Guardrail instructions  | `AGENTS.md` or `instructions/<slug>.md` | Loaded every turn in every app that receives it |
| Global skills           | `skills/<slug>/SKILL.md`                | Listed as workspace skills and read on demand   |
| Brand/company resources | `context/<slug>.md`                     | Indexed every turn, read when relevant          |
| Custom agent profiles   | `agents/<slug>.md`                      | Available as reusable local agent profiles      |
| Shared HTTP MCP servers | `mcp-servers/<slug>.json`               | Loaded into granted apps' MCP tool registry     |

These paths apply across all three scopes — workspace, organization/app, and personal. The later scope wins when the same path exists at multiple levels.

## Getting Started: a 1-minute walkthrough {#getting-started}

Change how the agent behaves, in 60 seconds.

1. Open the **Workspace** tab → **Shared** → `AGENTS.md` (create it with `+` → **File** if missing).
2. Add one rule, e.g.:

   ```markdown
   ## Tone

   Be concise. Lead with the answer.
   ```

3. Save, switch to **Chat**, ask anything — the agent follows the new rule immediately.

**Next steps, when you want them:**

- **Skills** (`+` → **Skill**) — focused how-to files invoked in chat with `/skill-name`.
- **Agents** (`+` → **Agent**) — reusable sub-agent personas invoked with `@agent-name`.
- **Scheduled Tasks** (`+` → **Scheduled Task**) — prompts that run on a cron.
- **Memory** — shared `LEARNINGS.md` and personal `memory/MEMORY.md` keep durable context available across conversations.

## Global resources and canonical paths {#global-resources}

Workspace-scope resources are managed from Dispatch's **Resources** page and inherited by apps at runtime — no copy or sync step. Dispatch supports two grant scopes:

- **All apps** — global resources every app in the workspace inherits. Most company, brand, persona, positioning, messaging, and guardrail context should be **All apps**.
- **Selected apps** — resources granted to specific apps for app-specific context or tools. Use these sparingly.

The path determines how the agent uses a resource (see the table in [Overview](#overview) above). This is the right home for core personas, positioning, messaging, company facts, brand guidelines, support policies, shared skills, or shared HTTP MCP tools that many apps should benefit from.

A useful starter pack for a new workspace:

```text
context/company.md              # what the company does, ICP, products, links
context/brand.md                # voice, visual identity, spelling, forbidden usage
context/messaging.md            # positioning, value props, proof points, objections
instructions/guardrails.md      # compliance, escalation, and approval rules
skills/company-voice/SKILL.md   # on-demand guidance for customer-facing writing
agents/<slug>.md                # reusable custom agent profiles
```

Keep `context/` files factual and easy to skim. Put rules that must apply every turn in `instructions/guardrails.md`. Use `skills/company-voice/SKILL.md` when the agent should deliberately transform or review copy in the company's voice.

To override a global default for one app or team, create a shared/organization resource in that app with the same path. To override it for one person, create a personal resource with the same path. Do not copy the workspace file into every app; the runtime resolves the stack on read:

```text
workspace context/brand.md
-> shared/app context/brand.md
-> personal context/brand.md
```

Example contents:

```text
<!-- context/company.md -->

# Company

- Company: Example Co
- Product: Agent-native workspace for internal teams
- ICP: Operations, support, and GTM teams managing many small tools
- Canonical links: https://example.com, https://docs.example.com

<!-- context/brand.md -->

# Brand

- Voice: direct, warm, concrete
- Use: "workspace", "agent", "team"
- Avoid: unsupported superlatives and vague AI claims

<!-- context/messaging.md -->

# Messaging

- Positioning: one control plane for every app agent
- Value props: shared context, shared credentials, cross-app delegation
- Proof points: fewer duplicated Slack bots, one vault, one policy surface

<!-- instructions/guardrails.md -->

# Guardrails

- Do not invent customer names, metrics, or legal claims.
- Ask for approval before changing shared instructions or All-app resources.
- Escalate security, billing, and data-loss concerns to an admin.

<!-- skills/company-voice/SKILL.md -->

---
name: company-voice
description: Rewrite or review customer-facing copy using the workspace brand and messaging resources.
---

Read `context/brand.md` and `context/messaging.md` before writing. Keep claims grounded in those files, preserve approved terminology, and flag missing proof instead of inventing it.
```

## Workspace Panel {#workspace-panel}

The agent panel includes a **Workspace** tab alongside Chat and CLI. This panel lets users browse workspace resources, create/edit/delete personal or organization resources, and view inherited workspace defaults. It displays a tree view of all resources organized by folder path.

Resources can be any text file — Markdown, JSON, YAML, plain text. The panel includes an inline editor for viewing and modifying resource content directly.

The `+` menu in Workspace supports typed creation flows for:

- **Files** — arbitrary resources
- **Skills** — reusable instruction files under `skills/`
- **Agents** — custom sub-agent profiles under `agents/*.md`
- **Scheduled Tasks** — recurring jobs under `jobs/`

When you open a resource, the editor shows an **Effective context** strip with the precedence stack:

```text
workspace default -> organization/app override -> personal override
```

If the same path exists at multiple levels, the later level wins. Workspace resources are still visible in the stack so users can see what was inherited and why an override is active.

Dispatch shows the same model from the control-plane side. On the **Resources** page, expand a resource and use **Effective in app** to choose an app and optional user email. From an app card's **Context** dialog, expand **Stack** on any resource row to see the same winner/override chain for that app.

When Dispatch approval policy is enabled, creating, updating, or deleting an **All apps** resource queues an approval request instead of applying immediately. The create/edit/delete dialogs show an impact preview before save.

Click the `?` icon in the Workspace toolbar to jump back to these docs at any time.

## How the Agent Uses Resources {#how-the-agent-uses-resources}

The built-in app agent manages resources with the unified `resources` tool: use `action: "list"`, `"read"`, `"effective"`, `"write"`, `"promote"`, or `"delete"`. External CLI/code agents can use the equivalent `pnpm action resource-*` commands.

At the start of every conversation, the agent automatically reads:

### AGENTS.md {#agents-md}

An instruction resource seeded by default. The agent loads `AGENTS.md` from workspace, shared/organization, and personal scopes in that order. Edit the workspace version from Dispatch for company-wide defaults, the shared/app version for team or app-specific rules, and the personal version for per-user preferences.

```text
# Agent Instructions

## Tone

Be concise. Lead with the answer.

## Code style

- Use TypeScript, never JavaScript
- Prefer named exports

## Skills

| Skill         | Path                            | Description                 |
| ------------- | ------------------------------- | --------------------------- |
| data-analysis | `skills/data-analysis/SKILL.md` | BigQuery and data workflows |
```

### Global Instructions {#global-instructions}

Use workspace `AGENTS.md` for company-wide defaults, shared `AGENTS.md` for app/team rules, and personal `AGENTS.md` for per-user preferences. Use files under `instructions/` for separate guardrail documents that should also apply every turn, such as compliance rules, customer-facing tone, escalation policy, or brand voice. These files use the same workspace -> organization/app -> personal precedence.

For example:

```text
AGENTS.md
instructions/customer-support-guardrails.md
instructions/legal-review-policy.md
```

Both normal chat and integration-triggered agent runs load these instruction resources before responding.

### Reference Resources {#reference-resources}

Put reusable company context under `context/`: personas, positioning, messaging, product facts, customer proof points, brand guidelines, competitive notes, and similar material. The agent sees an index of workspace and shared reference resources and reads the relevant file with the `resources` tool (`action: "read"`) when a task may depend on it. Use `resources` with `action: "effective"` and `path: "context/brand.md"` when you need to see whether a workspace default is overridden by an organization/app or personal resource.

### Memory {#memory}

The workspace has two current memory surfaces:

- `LEARNINGS.md` in **Shared** scope for project-wide conventions, corrections, and durable team knowledge.
- `memory/MEMORY.md` in **Personal** scope for structured memory about the current user.

The resource system also seeds a personal `LEARNINGS.md` for compatibility with older workspaces, but the chat preload path is shared `LEARNINGS.md` plus personal `memory/MEMORY.md`.

**What gets saved.** When you correct the agent ("no, always use X instead of Y"), share a preference ("I prefer concise answers"), or reveal context ("my team calls this 'the dispatch layer'"), the agent can capture that learning so it doesn't repeat the mistake or have to re-ask next time. Project-wide learnings belong in shared `LEARNINGS.md`; user-specific memory belongs under `memory/`. This behavior lives in the framework system prompt and the `capture-learnings` skill spells out the rules for when and how.

**What it looks like.**

```markdown
# Learnings

## Tone

- Be concise; skip preamble. (corrected 2026-01-14)

## Naming

- "Dispatch" refers to our internal event-routing service, not the template app.

## Preferences

- Prefer named exports over default exports in TypeScript.
```

**Where it fits.**

| Surface            | Scope              | Written by                           | Read when                              |
| ------------------ | ------------------ | ------------------------------------ | -------------------------------------- |
| `AGENTS.md`        | Shared             | Humans / agent on request            | Every turn                             |
| `LEARNINGS.md`     | Shared             | Humans / agent on request            | Every turn (shared copy only)          |
| `memory/MEMORY.md` | Personal           | Agent / humans                       | Every turn                             |
| `instructions/…`   | Shared             | Humans / agent on request            | Every turn                             |
| `skills/…`         | Shared             | Humans / agent on request            | On demand (`/slash` command)           |
| `context/…`        | Shared             | Humans / agent on request            | Indexed every turn, read when relevant |
| `mcp-servers/…`    | Workspace / shared | Humans via Dispatch or app workspace | MCP config refresh                     |

> A personal `LEARNINGS.md` is seeded for back-compat with older workspaces, but the chat preload path reads the shared copy. Put personal context in `memory/MEMORY.md` instead.

Users can edit these memory files directly in the Workspace tab — they're regular resources. Delete lines the agent got wrong, keep personal preferences in `memory/MEMORY.md`, or promote team-wide rules into `AGENTS.md`.

## Skills {#skills}

Skills are Markdown resource files that give the agent deep domain knowledge for specific tasks. They live under the `skills/` path prefix in resources, preferably as `skills/<name>/SKILL.md` (e.g. `skills/data-analysis/SKILL.md`, `skills/code-review/SKILL.md`). Flat `skills/<name>.md` files still work for compatibility.

When the agent encounters a task that matches a skill, it reads the skill file and follows its guidance. Skills referenced in `AGENTS.md` are discovered automatically.

### Creating Skills {#creating-skills}

There are two ways to add skills:

1. **Via Workspace tab** — Create a new resource with a path like `skills/my-skill/SKILL.md`. This works in both Code mode and App mode.
2. **Via code (Code mode only)** — Add a Markdown file to `.agents/skills/` in your project. These are available when the app runs in Code mode.

### Skill Format {#skill-format}

Skills are Markdown files with optional YAML frontmatter for metadata:

```markdown
---
name: data-analysis
description: BigQuery queries, data transforms, and visualization
---

# Data Analysis

## When to use

Use this skill when the user asks about data, queries, or analytics.

## Rules

- Always validate SQL before executing
- Prefer CTEs over subqueries
- Include LIMIT on exploratory queries
```

## Custom Agents {#custom-agents}

Custom agents are reusable local sub-agent profiles stored as Markdown resources under `agents/*.md`. Agent-teams.md and agent-mentions.md use `/docs/workspace#custom-agents` as the canonical reference for this pattern.

Use them when you want a focused delegate with its own name, description, model preference, and instruction set. Unlike skills, custom agents are not passive guidance — they are operational personas the main agent can invoke through `@` mentions or by selecting them during sub-agent spawning.

### Agent format {#agent-format}

Custom agents use YAML frontmatter plus Markdown instructions:

```markdown
---
name: Design
description: >-
  Reviews layouts, interaction patterns, and product UX decisions.
model: inherit
tools: inherit
delegate-default: false
---

# Role

You are a focused design agent.

## Responsibilities

- Review layouts and interaction flows
- Suggest stronger visual direction
- Be concise and opinionated
```

Recommended conventions:

- Store custom agents at `agents/<slug>.md`
- Use `model: inherit` unless the profile clearly needs a different model
- Keep `tools: inherit` for now; the field is reserved for future tool policies

### Remote agents vs custom agents {#remote-vs-custom-agents}

There are two agent types in Workspace:

- **Custom agents** — local profiles in `agents/*.md`, executed inside the current app/runtime
- **Connected agents** — remote A2A peers described by manifests in `remote-agents/*.json` (legacy `agents/*.json` manifests are still recognized)

Use custom agents for delegation within one app. Use connected agents when you need to call another app over A2A.

## @ Tagging {#at-tagging}

Type `@` in the chat input to reference workspace items. A dropdown appears at the cursor showing matching agents and files. Use arrow keys to navigate and Enter to select. The selected item appears as an inline chip in the input.

When you send a message:

- **Files/resources** are passed as references the agent can read
- **Custom agents** run locally with their profile instructions
- **Connected agents** are called over A2A

What shows up depends on the mode:

- **Code mode** — Codebase files, workspace resources, custom agents, and connected agents
- **App mode** — Workspace resources, custom agents, and connected agents

## / Slash Commands {#slash-commands}

Type `/` at the start of a line to invoke a skill. A dropdown shows available skills with their names and descriptions. Selecting a skill adds it as an inline chip, and its content is included as context when the message is sent.

What shows up depends on the mode:

- **Code mode** — Skills from `.agents/skills/` (codebase) and skills from resources
- **App mode** — Skills from resources only

If no skills are configured, the dropdown shows a hint with a link to these docs.

## Code vs App Mode {#dev-vs-prod}

The resource system works identically in both modes. The difference is what additional sources are available for `@` tagging and `/` commands:

| Feature            | Code Mode                                                               | App Mode                                               |
| ------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| @ tagging          | Codebase files + workspace resources + custom agents + connected agents | Workspace resources + custom agents + connected agents |
| / slash commands   | .agents/skills/ + resource skills                                       | Resource skills only                                   |
| Agent file access  | Filesystem + resources                                                  | Resources only                                         |
| Workspace panel    | Full access                                                             | Full access                                            |
| AGENTS.md / memory | Available                                                               | Available                                              |

## Workspace Connections {#workspace-connections}

Workspace Connections let apps share the same provider account (Slack, GitHub, HubSpot, etc.) without duplicating credentials. A connection records provider identity, account labels, status, scopes, app grants, and credential references in SQL. Secrets stay in the credential store; connections only point at credential key names such as `SLACK_BOT_TOKEN`.

See [Workspace Connections](/docs/workspace-connections) for the quickstart, connection/grant/credentialRef API, and concrete Slack, HubSpot, and GitHub examples.

## Resource API {#resource-api}

Resources can be managed from server code, actions, or the REST API.

### Server API {#server-api}

REST endpoints mounted automatically:

| Method   | Endpoint                                      | Description                          |
| -------- | --------------------------------------------- | ------------------------------------ |
| `GET`    | `/_agent-native/resources?scope=all`          | List resources                       |
| `GET`    | `/_agent-native/resources?scope=workspace`    | List inherited workspace resources   |
| `GET`    | `/_agent-native/resources/tree?scope=all`     | Get folder tree                      |
| `GET`    | `/_agent-native/resources/effective?path=...` | Show the effective inheritance stack |
| `POST`   | `/_agent-native/resources`                    | Create a resource                    |
| `GET`    | `/_agent-native/resources/:id`                | Get resource with content            |
| `PUT`    | `/_agent-native/resources/:id`                | Update a resource                    |
| `DELETE` | `/_agent-native/resources/:id`                | Delete a resource                    |
| `POST`   | `/_agent-native/resources/upload`             | Upload a file as resource            |

### Action API {#script-api}

The agent uses these built-in actions. You can also call them from your own actions:

```bash
# List all resources
pnpm action resource-list --scope all

# Read a resource
pnpm action resource-read --path "skills/my-skill/SKILL.md"

# Read inherited workspace context managed by Dispatch
pnpm action resource-read --scope workspace --path "context/brand.md"

# Show workspace -> organization/app -> personal precedence for a path
pnpm action resource-effective --path "context/brand.md"

# Write a resource
pnpm action resource-write --path "notes/meeting.md" --content "# Meeting Notes..."

# Delete a resource
pnpm action resource-delete --path "notes/old.md"
```
