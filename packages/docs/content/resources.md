---
title: "Workspace Resources"
description: "SQL-backed workspace files for notes, skills, custom agents, scheduled tasks, and instructions."
---

# Workspace Resources

The **Workspace** tab is where you and the agent share persistent files — notes, instructions, skills, custom agents, and scheduled jobs. Files live in the database (not the filesystem), so they persist across sessions, work in serverless/edge deploys, and can be edited from both the UI and the agent.

## TL;DR {#tldr}

- Open the **Workspace** tab in the agent sidebar.
- Create files with the `+` menu. Upload with the upload button. Edit inline (visual or code view).
- **Personal** is just you. **Shared** is your team/org.
- The agent can read, write, and rename any of these files as part of a conversation.
- Special files the agent always reads: `AGENTS.md` (team rules) and `learnings.md` (per-user).

## What goes in here? {#what-goes-in-here}

| File / path               | What it's for                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `AGENTS.md` (Shared)      | Team instructions the agent reads every turn — tone, rules, domain context, skill references. |
| `learnings.md` (Personal) | Corrections and preferences the agent records per user so it doesn't repeat mistakes.         |
| `skills/<name>.md`        | Focused domain guidance the agent pulls in on demand (invoked with `/` slash commands).       |
| `agents/<name>.md`        | Custom sub-agent profiles the agent can delegate to (invoked with `@` mentions).              |
| `agents/<name>.json`      | A2A manifests for connected remote agents.                                                    |
| `jobs/<name>.md`          | Scheduled tasks that run on a cron (see the recurring-jobs docs).                             |
| Anything else             | Notes, prompts, config, dataset snippets — any text file.                                     |

## Overview {#overview}

Every agent-native app has a built-in resource system. Resources are SQL-backed files that persist across sessions and deployments. Unlike code files, resources live in the database — not the filesystem — so they work in serverless environments, edge runtimes, and production deploys without any filesystem dependency.

Resources have two scopes:

- **Personal** — scoped to a single user (their email). Good for preferences, notes, and per-user context.
- **Shared** — visible to all users. Good for team instructions, skills, and shared config.

## Workspace Panel {#workspace-panel}

The agent panel includes a **Workspace** tab alongside Chat and CLI. This panel lets users browse, create, edit, and delete workspace resources. It displays a tree view of all resources organized by folder path.

Resources can be any text file — Markdown, JSON, YAML, plain text. The panel includes an inline editor for viewing and modifying resource content directly.

The `+` menu in Workspace supports typed creation flows for:

- **Files** — arbitrary resources
- **Skills** — reusable instruction files under `skills/`
- **Agents** — custom sub-agent profiles under `agents/*.md`
- **Scheduled Tasks** — recurring jobs under `jobs/`

Workspace resources come in two scopes:

- **Personal** — visible only to the current user
- **Shared** — visible across the team/org

Click the `?` icon in the Workspace toolbar to jump back to these docs at any time.

## Getting Started: a 5-minute walkthrough {#getting-started}

A tour that ends with the agent following your house rules and running a skill you wrote yourself.

### 1. Write team instructions in `AGENTS.md`

`AGENTS.md` is a Shared resource the agent reads at the start of every conversation. Anything you put here changes the agent's default behavior for everyone on the team.

1. Open the **Workspace** tab.
2. In the **Shared** tree, click `AGENTS.md` (it's seeded for you). If it doesn't exist, hit `+` → **File**, name it `AGENTS.md`, scope **Shared**.
3. Paste this as a starter and tweak:

   ```markdown
   # Agent Instructions

   ## Tone

   Be concise. Lead with the answer, then explain.

   ## Code style

   - TypeScript only, never `.js`
   - Use `defineAction` for new operations
   - No browser dialogs (`window.confirm`) — use shadcn `AlertDialog`

   ## Domain context

   We are building an internal scheduling app. "Org" means a customer tenant.
   ```

4. Save. Open the **Chat** tab and ask the agent a question about your project. It should already be following the tone / style rules.

**Tip:** when the agent misbehaves, ask it to "update AGENTS.md so this doesn't happen again." It will edit the file for you.

### 2. Add your first skill

Skills are focused Markdown files the agent pulls in on demand. They're perfect for "here's exactly how we do X" knowledge that's too long for `AGENTS.md`.

1. In Workspace, click `+` → **Skill**.
2. Name it `bug-triage`, scope **Shared**.
3. Replace the body with:

   ```markdown
   ---
   name: bug-triage
   description: Triage a new bug report — reproduce, classify, file.
   ---

   # Bug Triage

   ## When to use

   Use whenever the user pastes a stack trace or describes a bug.

   ## Steps

   1. Restate the bug in one sentence.
   2. Identify severity: blocker / major / minor.
   3. Suggest a minimal reproduction.
   4. Check existing issues with `gh issue list` before filing a new one.
   ```

4. Save. Switch to **Chat** and type `/bug-triage` — you should see your skill in the dropdown. Select it, add a bug description, send.

The agent will follow the skill's steps. Skills don't need to be registered anywhere — dropping them under `skills/` is enough.

### 3. Teach the agent with a correction

1. In Chat, ask the agent to do anything small, like "add a new button to the homepage."
2. When the agent finishes, say: "From now on, always put new buttons in the top-right of the header, not the body."
3. The agent writes that rule to your Personal `learnings.md`. Next time you ask for a button, it places it correctly — for you, not for teammates.

Open `learnings.md` in Workspace anytime to review or edit what the agent has picked up about you.

### 4. Delegate to a custom sub-agent

When one persona keeps coming up ("review my designs," "write release notes"), turn it into a reusable sub-agent.

1. In Workspace, click `+` → **Agent**.
2. Pick a prompt like "You are a release-notes writer: terse, user-facing, no jargon."
3. Save. In Chat, type `@release-notes` and ask it to draft notes from the last few commits.

The sub-agent inherits your model and tools but follows only the instructions you wrote.

### 5. (Optional) Make it recurring

Anything a sub-agent can do on request, a **Scheduled Task** can do on a cron.

1. `+` → **Scheduled Task**.
2. Give it a name, a cron like `0 9 * * MON`, and a prompt ("Summarize last week's PRs and post to Slack").
3. Save. See the [recurring jobs docs](https://www.builder.io/c/docs/agent-native-jobs) for the full job runner.

---

That's the whole loop: instructions in `AGENTS.md`, on-demand knowledge in `skills/`, reusable personas in `agents/`, and automation in `jobs/`. Everything lives in the database, so it survives deploys and is visible to every user (or just you) based on scope.

## How the Agent Uses Resources {#how-the-agent-uses-resources}

The agent has built-in tools for managing resources: `resource-list`, `resource-read`, `resource-write`, and `resource-delete`. These are available in both dev and production modes.

At the start of every conversation, the agent automatically reads:

### AGENTS.md {#agents-md}

A shared resource seeded by default. It contains custom instructions, preferences, and skill references. Edit this to change how the agent behaves for all users — tone, rules, domain context, and which skills to use.

```text
# Agent Instructions

## Tone
Be concise. Lead with the answer.

## Code style
- Use TypeScript, never JavaScript
- Prefer named exports

## Skills
| Skill | Path | Description |
|-------|------|-------------|
| data-analysis | `skills/data-analysis.md` | BigQuery and data workflows |
```

### learnings.md {#learnings-md}

A personal resource where the agent records corrections, preferences, and patterns it learns from each user. When the agent makes a mistake and the user corrects it, the agent updates `learnings.md` so it doesn't repeat the error.

## Skills {#skills}

Skills are Markdown resource files that give the agent deep domain knowledge for specific tasks. They live under the `skills/` path prefix in resources (e.g. `skills/data-analysis.md`, `skills/code-review.md`).

When the agent encounters a task that matches a skill, it reads the skill file and follows its guidance. Skills referenced in `AGENTS.md` are discovered automatically.

### Creating Skills {#creating-skills}

There are two ways to add skills:

1. **Via Workspace tab** — Create a new resource with a path like `skills/my-skill.md`. This works in both dev and production.
2. **Via code (dev only)** — Add a Markdown file to `.agents/skills/` in your project. These are available when the app runs in dev mode.

## Custom Agents {#custom-agents}

Custom agents are reusable local sub-agent profiles stored as Markdown resources under `agents/*.md`.

Use them when you want a focused delegate with its own:

- name
- description
- model preference
- instruction set

Unlike skills, custom agents are not passive guidance. They are operational personas the main agent can invoke through `@` mentions or by selecting them during sub-agent spawning.

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
- **Connected agents** — remote A2A peers described by manifests in `agents/*.json`

Use custom agents for delegation within one app. Use connected agents when you need to call another app over A2A.

### Skill Format {#skill-format}

Skills are Markdown files with optional YAML frontmatter for metadata:

````text
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

## Patterns
```sql
-- Standard BigQuery date filter
WHERE DATE(created_at) BETWEEN @start_date AND @end_date
````

````

## @ Tagging {#at-tagging}

Type `@` in the chat input to reference workspace items. A dropdown appears at the cursor showing matching agents and files. Use arrow keys to navigate and Enter to select. The selected item appears as an inline chip in the input.

When you send a message:

- **Files/resources** are passed as references the agent can read
- **Custom agents** run locally with their profile instructions
- **Connected agents** are called over A2A

What shows up depends on the mode:

- **Dev mode** — Codebase files, workspace resources, custom agents, and connected agents
- **Production mode** — Workspace resources, custom agents, and connected agents

## / Slash Commands {#slash-commands}

Type `/` at the start of a line to invoke a skill. A dropdown shows available skills with their names and descriptions. Selecting a skill adds it as an inline chip, and its content is included as context when the message is sent.

What shows up depends on the mode:

- **Dev mode** — Skills from `.agents/skills/` (codebase) and skills from resources
- **Production mode** — Skills from resources only

If no skills are configured, the dropdown shows a hint with a link to these docs.

## Dev vs Production Mode {#dev-vs-prod}

The resource system works identically in both modes. The difference is what additional sources are available for `@` tagging and `/` commands:

| Feature | Dev Mode | Production |
|---------|----------|------------|
| @ tagging | Codebase files + workspace resources + custom agents + connected agents | Workspace resources + custom agents + connected agents |
| / slash commands | .agents/skills/ + resource skills | Resource skills only |
| Agent file access | Filesystem + resources | Resources only |
| Workspace panel | Full access | Full access |
| AGENTS.md / learnings.md | Available | Available |

## Resource API {#resource-api}

Resources can be managed from server code, actions, or the REST API.

### Server API {#server-api}

REST endpoints mounted automatically:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/_agent-native/resources?scope=all` | List resources |
| `GET` | `/_agent-native/resources/tree?scope=all` | Get folder tree |
| `POST` | `/_agent-native/resources` | Create a resource |
| `GET` | `/_agent-native/resources/:id` | Get resource with content |
| `PUT` | `/_agent-native/resources/:id` | Update a resource |
| `DELETE` | `/_agent-native/resources/:id` | Delete a resource |
| `POST` | `/_agent-native/resources/upload` | Upload a file as resource |

### Action API {#script-api}

The agent uses these built-in actions. You can also call them from your own actions:

```bash
# List all resources
pnpm action resource-list --scope all

# Read a resource
pnpm action resource-read --path "skills/my-skill.md"

# Write a resource
pnpm action resource-write --path "notes/meeting.md" --content "# Meeting Notes..."

# Delete a resource
pnpm action resource-delete --path "notes/old.md"
````
