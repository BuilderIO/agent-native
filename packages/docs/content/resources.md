---
title: "Resources & Skills"
description: "SQL-backed persistent files for notes, configs, skills, and agent instructions."
---

# Resources & Skills

Resources are persistent files stored in the database — notes, configs, skill files, and more. They're available to both the UI and the agent, and work the same locally and in production.

## Overview {#overview}

Every agent-native app has a built-in resource system. Resources are SQL-backed files that persist across sessions and deployments. Unlike code files, resources live in the database — not the filesystem — so they work in serverless environments, edge runtimes, and production deploys without any filesystem dependency.

Resources have two scopes:

- **Personal** — scoped to a single user (their email). Good for preferences, notes, and per-user context.
- **Shared** — visible to all users. Good for team instructions, skills, and shared config.

## Resources Panel {#resources-panel}

The agent panel includes a **Resources** tab alongside Chat and CLI. This panel lets users browse, create, edit, and delete resources. It displays a tree view of all resources organized by folder path.

Resources can be any text file — Markdown, JSON, YAML, plain text. The panel includes an inline editor for viewing and modifying resource content directly.

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

1. **Via Resources panel** — Create a new resource with a path like `skills/my-skill.md`. This works in both dev and production.
2. **Via code (dev only)** — Add a Markdown file to `.agents/skills/` in your project. These are available when the app runs in dev mode.

### Skill Format {#skill-format}

Skills are Markdown files with optional YAML frontmatter for metadata:

```text
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
```
```

## @ File Tagging {#at-file-tagging}

Type `@` in the chat input to reference files. A dropdown appears at the cursor showing matching files. Use arrow keys to navigate and Enter to select. The selected file appears as an inline chip in the input.

When you send a message with file references, the agent receives the file paths as context and can read them using its tools.

What shows up depends on the mode:

- **Dev mode** — Codebase files (from the filesystem) and resource files (from the database)
- **Production mode** — Resource files only

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
| @ file tagging | Codebase files + resources | Resources only |
| / slash commands | .agents/skills/ + resource skills | Resource skills only |
| Agent file access | Filesystem + resources | Resources only |
| Resources panel | Full access | Full access |
| AGENTS.md / learnings.md | Available | Available |

## Resource API {#resource-api}

Resources can be managed from server code, actions, or the REST API.

### Server API {#server-api}

REST endpoints mounted automatically:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/resources?scope=all` | List resources |
| `GET` | `/api/resources/tree?scope=all` | Get folder tree |
| `POST` | `/api/resources` | Create a resource |
| `GET` | `/api/resources/:id` | Get resource with content |
| `PUT` | `/api/resources/:id` | Update a resource |
| `DELETE` | `/api/resources/:id` | Delete a resource |
| `POST` | `/api/resources/upload` | Upload a file as resource |

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
```
