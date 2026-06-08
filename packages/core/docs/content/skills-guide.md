---
title: "Skills Guide"
description: "How skills work in agent-native: framework skills, domain skills, and creating custom skills."
---

# Skills Guide

Skills are Markdown files that give the agent deep knowledge about specific patterns and workflows.

## What are skills {#what-are-skills}

Skills live at `.agents/skills/<name>/SKILL.md` and contain detailed guidance for the agent. Each skill focuses on one concern — how to store data, how to sync state, how to delegate work to the agent chat.

The agent reads skills when it needs to follow a specific pattern. Skills are referenced in `AGENTS.md` and triggered by the agent's tool system when relevant.

## Framework skills {#framework-skills}

These skills ship with the framework and apply to all agent-native apps:

| Skill                 | When to use                                            |
| --------------------- | ------------------------------------------------------ |
| `storing-data`        | Adding data models, reading/writing config or state    |
| `real-time-sync`      | Wiring polling sync, debugging UI not updating         |
| `delegate-to-agent`   | Delegating AI work from UI or actions to the agent     |
| `actions`             | Creating or running agent actions                      |
| `self-modifying-code` | Editing app source, components, or styles              |
| `create-skill`        | Adding new skills for the agent                        |
| `capture-learnings`   | Recording corrections and patterns                     |
| `frontend-design`     | Building or styling any web UI, components, or pages   |
| `adding-a-feature`    | The four-area checklist: UI, script, skills, app-state |
| `context-awareness`   | Exposing UI state to the agent, view-screen, navigate  |
| `a2a-protocol`        | Inter-agent communication via JSON-RPC                 |

## Domain skills {#domain-skills}

Templates include skills specific to their domain. These live in the same `.agents/skills/` directory but cover template-specific patterns:

- **Mail template** — email-drafts, thread-management, label-system
- **Forms template** — form-building, field-types, submission-handling
- **Analytics template** — chart-types, data-connectors, query-patterns
- **Slides template** — deck-management, slide-layouts, theme-system

Domain skills follow the same format as framework skills. They encode patterns specific to the template that the agent needs to follow.

## App-backed skills {#app-backed-skills}

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
name: my-skill
description: >-
  One-line description of what this skill covers and when
  the agent should use it.
---

# Skill Title

## Rule

The core invariant — what must always be true.

## Why

Why this rule exists. Motivates the agent to follow it.

## How

Step-by-step instructions with code examples.

## Do

- Concrete actions the agent should take

## Don't

- Anti-patterns to avoid

## Related Skills

- **other-skill** — How it relates
```

The frontmatter `name` and `description` are used by the agent's tool system for skill discovery. The description should state when the skill triggers — be specific about the situations.

Save the file at `.agents/skills/my-skill/SKILL.md`. The directory name should match the `name` in frontmatter.

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
