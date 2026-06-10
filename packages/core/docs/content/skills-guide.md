---
title: "Skills Guide"
description: "How skills work in agent-native: framework skills, domain skills, and creating custom skills."
---

# Skills Guide

Skills are Markdown files that give the agent deep knowledge about specific patterns and workflows.

## What are skills {#what-are-skills}

Skills live at `.agents/skills/<name>/SKILL.md` and contain detailed guidance for the agent. Each skill focuses on one concern — how to store data, how to sync state, how to delegate work to the agent chat.

Every skill's frontmatter `name` and `description` are always injected into the system prompt's skills block so the agent knows what skills exist. The full skill body is loaded on demand when the agent decides a skill is relevant to the task (it is also surfaced via `docs-search`). This is why keeping descriptions short and trigger-specific matters: the description is the only thing the agent reads before deciding whether to load the rest.

## Framework skills {#framework-skills}

These skills ship with the default template and are available in every new agent-native app:

| Skill                 | When to use                                             |
| --------------------- | ------------------------------------------------------- |
| `storing-data`        | Adding data models, reading/writing config or state     |
| `real-time-sync`      | Wiring polling sync, debugging UI not updating          |
| `delegate-to-agent`   | Delegating AI work from UI or actions to the agent      |
| `actions`             | Creating or running agent actions                       |
| `self-modifying-code` | Editing app source, components, or styles               |
| `create-skill`        | Adding new skills for the agent                         |
| `capture-learnings`   | Recording corrections and patterns                      |
| `frontend-design`     | Building or styling any web UI, components, or pages    |
| `adding-a-feature`    | The four-area checklist: UI, actions, skills, app-state |
| `shadcn-ui`           | Using shadcn/ui primitives and components               |
| `security`            | Auth, access control, and secret handling               |
| `real-time-collab`    | Multi-user collaborative editing                        |
| `agent-engines`       | Swapping or configuring the underlying agent engine     |
| `notifications`       | In-app and push notification patterns                   |
| `progress`            | Tracking and surfacing background task progress         |
| `inline-embeds`       | Embedding apps or iframes inside the agent chat         |

`context-awareness` and `a2a-protocol` are framework-level skills available in the `.agents/skills/` directory at the repo root — see each template's own `.agents/skills/` for what it inherits.

## Domain skills {#domain-skills}

Templates include skills specific to their domain. These live in the same `.agents/skills/` directory but cover template-specific patterns. See each template's `.agents/skills/` directory for the full list; a representative sample:

- **Mail template** — `email-drafts`, `draft-queue`
- **Forms template** — `form-building`, `form-publishing`, `form-responses`
- **Analytics template** — `adhoc-analysis`, `bigquery`, `cross-source-analysis`, `dashboard-management`, `data-querying`, `provider-api`, `gong`, `hubspot`, `prometheus`
- **Slides template** — `create-deck`, `deck-management`, `design-systems`, `slide-editing`, `slide-images`

Domain skills follow the same format as framework skills. They encode patterns specific to the template that the agent needs to follow.

## App-backed skills {#app-backed-skills}

App-backed skills package an agent-native app as a skill marketplace artifact. The bundle can include agent instructions, exported skills, MCP connector metadata, hosted/local launch instructions, and UI surfaces such as MCP Apps.

> **Full details below:** the mechanics of app-backed skills (manifest format, CLI commands, marketplace adapters, auto-update hashing) are covered in [App-backed skills — full details](#app-backed-skills-full).

## Creating custom skills {#creating-skills}

Create a skill when:

- There's a pattern the agent should follow repeatedly
- A workflow needs step-by-step guidance
- You want to scaffold files from a template

Don't create a skill when:

- The guidance already exists in another skill — extend it instead
- The guidance is a one-off — put it in `AGENTS.md` or workspace memory instead

## Skill format {#skill-format}

Each skill is a Markdown file with YAML frontmatter:

```markdown
---
name: project-imports
description: >-
  How to import projects from the legacy CSV export. Use when the user uploads
  a project CSV or asks to migrate projects from the old system.
---

# Project Imports

## Rule

Always validate the CSV header row before writing any rows. Reject unknown
columns rather than silently dropping them.

## Why

The legacy export has three known formats. Silently skipping columns causes data
loss that is hard to notice until the migration is audited.

## How

1. Call `get-import-schema` to fetch the expected columns for the target project type.
2. Parse the first CSV row and diff against the schema.
3. If any required columns are missing, return an error listing them — do not proceed.
4. Stream remaining rows through `create-project-item` in batches of 50.
5. Return a summary: rows processed, rows skipped, and any errors.

## Do

- Run `view-screen` before importing so you know the user's current project context.
- Use the `sharing` skill after import if the project should be shared with collaborators.

## Don't

- Don't hold all rows in memory — stream them.
- Don't create duplicate projects; check for an existing project with the same name first.

## Related Skills

- **storing-data** — SQL schema and write patterns for new project rows
- **sharing** — Exposing a project to other users after import
```

The frontmatter `name` and `description` are used by the agent's tool system for skill discovery. The description should state when the skill triggers — be specific about the situations.

Save the file at `.agents/skills/my-skill/SKILL.md`. The directory name should match the `name` in frontmatter.

> **See also:** [Writing Agent Instructions](/docs/writing-agent-instructions) for how to word skill descriptions, apply progressive disclosure, and keep `AGENTS.md` lean. Both pages use the `project-imports` skill as a running example.

## Skill scope: runtime vs dev {#skill-scope}

An optional `scope` frontmatter field controls which agent a skill is for:

| `scope`   | Loaded by the runtime agent? | Use for                                                                         |
| --------- | ---------------------------- | ------------------------------------------------------------------------------- |
| `both`    | Yes (default)                | Skills useful to the in-app agent. This is the default when `scope` is omitted. |
| `runtime` | Yes                          | Skills meant only for the in-app runtime agent.                                 |
| `dev`     | No                           | Skills meant only for the human's coding agent (e.g. Claude Code).              |

```markdown
---
name: release-checklist
description: >-
  Steps for cutting a release. Use when preparing or publishing a new version.
scope: dev
---
```

When `scope` is absent (or set to an unrecognized value) it defaults to `both`, so every existing skill keeps loading at runtime — this field is fully backward compatible. A `scope: dev` skill is invisible to the runtime agent everywhere: it is excluded from the skills block injected into the system prompt and from `docs-search` results.

### Exposing a dev-only skill to your coding agent {#dev-only-skills}

The agent-native runtime reads skills from `.agents/skills/`. Claude Code reads skills from `.claude/skills/` independently. To make a skill available to your coding agent but hidden from the runtime agent:

- Mark it `scope: dev` in `.agents/skills/<name>/SKILL.md` so the runtime agent never loads it, and/or
- Place or mirror the skill under `.claude/skills/<name>/SKILL.md` so Claude Code picks it up.

This replaces the old hack of relying on Claude Code only reading `.claude/skills` — `scope: dev` makes the dev-vs-runtime split a first-class, explicit choice.

> **See also:** [Writing Agent Instructions](/docs/writing-agent-instructions) for how to word skill descriptions, apply progressive disclosure, and keep `AGENTS.md` lean.

## Skills vs AGENTS.md {#skills-vs-agents-md}

> **AGENTS.md** — The overview. Lists all scripts, describes the data model, explains the app architecture. The agent reads this first to understand the app.
>
> **Skills** — Deep dives. Each skill focuses on one pattern with detailed rules, code examples, and do/don't lists. The agent reads these when it needs to follow a specific pattern.

`AGENTS.md` tells the agent _what_ the app does. Skills tell the agent _how_ to do specific things correctly. Both are needed — `AGENTS.md` for orientation, skills for execution.

## Skills vs memory {#skills-vs-memory}

> **Skills** — Authored, reusable how-to guides. Apply to every user, invoked on demand when the task matches.
>
> **Memory (`LEARNINGS.md` / `memory/MEMORY.md`)** — Shared project learnings and personal structured memory loaded every turn.

If the knowledge applies to _everyone_ working in the app ("always prefer CTEs over subqueries"), it's a skill or shared `LEARNINGS.md`. If it's about _this particular user_ ("Steve likes concise answers"), it belongs in `memory/MEMORY.md`. See [Workspace Memory](/docs/workspace#memory) for the full treatment.

---

## App-backed skills — full details {#app-backed-skills-full}

App-backed skills package an agent-native app as a skill marketplace artifact.
The bundle can include agent instructions, exported skills, MCP connector
metadata, hosted/local launch instructions, and UI surfaces such as MCP Apps.

Each app-backed skill starts with `agent-native.app-skill.json` at the app root:

```json
{
  "schemaVersion": 1,
  "id": "assets",
  "hosted": {
    "url": "https://assets.agent-native.com",
    "mcpUrl": "https://assets.agent-native.com/_agent-native/mcp"
  },
  "mcp": { "serverName": "agent-native-assets" },
  "skills": [
    {
      "path": ".agents/skills/asset-generation",
      "visibility": "both",
      "exportAs": "assets"
    }
  ]
}
```

Skill visibility controls what ships:

| Visibility | Meaning                                                         |
| ---------- | --------------------------------------------------------------- |
| `internal` | Used by the app's own agent, not exported to marketplaces.      |
| `exported` | Exported to marketplaces, but not needed by the app internally. |
| `both`     | Used internally and exported.                                   |

Hosted is the default install path. Local launch is explicit for customization,
offline work, or privacy-sensitive use.

```bash
# Happy path: exported instructions plus hosted MCP connector.
npx @agent-native/core@latest skills add visual-plan
npx @agent-native/core@latest skills add assets

# Vercel/open Skills CLI: exported instructions only, no MCP config.
npx skills add BuilderIO/agent-native --skill assets

# Register a hosted MCP connector for local agent clients.
agent-native app-skill ensure --manifest templates/assets/agent-native.app-skill.json

# Materialize and run editable local source.
agent-native app-skill launch --manifest templates/assets/agent-native.app-skill.json --local --into ./assets-local

# Build marketplace adapters: Codex plugin, Claude marketplace, Vercel skills,
# plain/Claude skills, and MCP configs.
agent-native app-skill pack --manifest templates/assets/agent-native.app-skill.json --out ./dist/assets-skill

# Install a local exported bundle with the Vercel/open Skills CLI.
npx skills add ./dist/assets-skill --skill assets -a codex -y

# Add the generated Claude Code marketplace, then install its Assets plugin.
claude plugin marketplace add ./dist/assets-skill/adapters/claude-marketplace
claude plugin install agent-native-assets@agent-native-apps
```

Keep secrets out of skill files. The manifest should contain URL-only connector
metadata; OAuth/device setup happens in the MCP host or through the app's normal
settings flow.

The Vercel Labs `skills` adapter is a portable `skills/<name>/SKILL.md` bundle
for `npx skills add ...`, but the raw `skills` CLI installs instructions only.
It does not run repo-defined postinstall scripts or register MCP connectors.
Keep the Agent Native CLI as the default docs path for local agents because it
also registers the MCP connector. `BuilderIO/agent-native` is a real GitHub
repository source for the Vercel/open Skills CLI; `skills.sh` is a discovery and
leaderboard directory, not an npm-style package namespace.

The Claude Code marketplace adapter writes
`adapters/claude-marketplace/.claude-plugin/marketplace.json` plus a nested
plugin directory containing `skills/<name>/SKILL.md` and `.mcp.json`. In Claude
Code, add the marketplace, install `agent-native-assets@agent-native-apps`,
reload plugins, then authenticate the URL-only MCP connector from `/mcp`.

Generated plugin manifests are set up to auto-update: the Claude Code
marketplace entry sets `autoUpdate: true` (with commit-SHA versioning) and the
Codex plugin `version` embeds a content hash of the bundled skills and MCP
endpoint, so installed plugins pick up skill changes without re-packing. The
Plan app is published this way as a ready-to-add marketplace at the repo root —
see [Plan plugin & marketplace](/docs/plan-plugin) for the end-to-end install
and auto-update flow.

For users who install copied skills through the universal CLI instead of a
plugin marketplace, use the CLI freshness commands:

```bash
npx @agent-native/core@latest skills status visual-plan
npx @agent-native/core@latest skills update visual-plan
```

`skills update` scans known Codex/Claude project and user skill folders, compares
the copied folder hash to the latest bundled skill, and rewrites stale folders in
place. Newly copied Agent Native skills include an `agent-native-skill.json`
marker so future status output can identify the source and hash.
