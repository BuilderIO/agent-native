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

## Creating custom skills {#creating-skills}

Create a skill when:

- There's a pattern the agent should follow repeatedly
- A workflow needs step-by-step guidance
- You want to scaffold files from a template

Don't create a skill when:

- The guidance already exists in another skill — extend it instead
- The guidance is a one-off — put it in `AGENTS.md` or `learnings.md` instead

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

## Skills vs AGENTS.md {#skills-vs-agents-md}

> **AGENTS.md** — The overview. Lists all scripts, describes the data model, explains the app architecture. The agent reads this first to understand the app.
>
> **Skills** — Deep dives. Each skill focuses on one pattern with detailed rules, code examples, and do/don't lists. The agent reads these when it needs to follow a specific pattern.

`AGENTS.md` tells the agent _what_ the app does. Skills tell the agent _how_ to do specific things correctly. Both are needed — `AGENTS.md` for orientation, skills for execution.
