---
name: capture-learnings
description: >-
  Capture and apply accumulated knowledge via structured memory. Use when the
  user gives feedback, shares preferences, corrects a mistake, or when you
  discover something worth remembering for future conversations.
user-invocable: false
metadata:
  internal: true
---

# Capture Learnings

This is background knowledge, not a slash command. **Organization learnings and your personal memory index are loaded at the start of every conversation, including Slack/integration turns.** Capture durable context proactively when you learn something worth remembering.

## How to Read & Write Memories

Memories are stored as **resources** in the SQL database, not as files on disk.

- **Team/organization knowledge:** shared `LEARNINGS.md`. Read it first, merge the new fact, then write the full updated file with the `resources` tool using `scope: "shared"`. Shared scope resolves to the active organization; it must never leak to another organization in the same deployment.
- **Personal knowledge:** `memory/MEMORY.md` plus `memory/<name>.md`, written with `save-memory`.

- **Save a memory:** `save-memory --name <name> --type <type> --description "..." --content "..."`
- **Read a memory:** `resource-read --path memory/<name>.md`
- **Delete a memory:** `delete-memory --name <name>`
- **List all memories:** `resource-list --prefix memory/`

## Memory Types

| Type | Use for |
|------|---------|
| `user` | Preferences, role, personal context, contacts |
| `feedback` | Corrections, confirmed approaches, things to avoid or repeat |
| `project` | Ongoing work context, decisions, deadlines, status |
| `reference` | Pointers to external systems, URLs, API details |

## When to Capture

### Team and organization knowledge (`LEARNINGS.md`, shared scope)
- Canonical destinations and workflows (for example, which Content database receives a type of Slack request)
- Required intake fields, ownership, prioritization conventions, metric definitions, and approved terminology
- Durable external references that the whole team needs, including the canonical page/database URL
- Corrections or decisions that should affect every organization member's future Slack and app conversations

Store the fact and a concise provenance link when available. Do not paste full private conversations, customer data, credentials, or secrets into learnings. Put stable always-on policy in shared `AGENTS.md`; put learned facts and evolving conventions in shared `LEARNINGS.md`.

### User Preferences & Memory (`user`)
- **Tone and style** — "I prefer casual tone", "don't use emojis", "keep replies short"
- **Personal context** — contacts, relationships, habits ("my wife's email is...", "I'm in PST timezone")
- **Workflow preferences** — "always CC my assistant", "I like to review before sending"
- **Role and expertise** — "I'm a data scientist", "new to React"

### Feedback & Corrections (`feedback`)
- **Corrections** — user says "no, do it this way" → capture the right way
- **Confirmed approaches** — user validates a non-obvious choice ("yes, that's perfect")
- **Repeated friction** — you hit the same issue twice; save it

### Project Context (`project`)
- **Ongoing work** — who is doing what, why, by when
- **Decisions** — why something is done a certain way
- **Status** — current state of initiatives

### References (`reference`)
- **External systems** — "bugs are tracked in Linear project INGEST"
- **URLs** — dashboards, documentation, tools
- **API quirks** — undocumented behavior, version-specific gotchas

### Don't Capture
- Things obvious from reading the code
- Standard language/framework behavior
- Temporary debugging notes
- Anything already in AGENTS.md, shared LEARNINGS.md, or skills
- Ephemeral task details (use tasks/plans instead)

## Key Rules

1. **Save proactively — don't ask permission.** When you learn something durable, save it immediately at the correct scope.
2. **Choose scope by audience.** Organization workflow or reference → shared `LEARNINGS.md`; one person's preference/context → personal memory.
3. **One memory per topic** — e.g. `coding-style`, `project-alpha`, not one giant dump
4. **Read before updating** — if a memory exists, read it first and merge, don't overwrite
5. **Keep descriptions concise** — the index is loaded every conversation
6. **Memories are SQL-backed** — they persist across sessions and are not in git; still minimize sensitive content

## Graduation

When a memory is referenced repeatedly, it may belong in AGENTS.md or a skill:
- Saving a personal memory is lightweight (auto-apply, personal scope)
- Shared LEARNINGS.md is the lightweight organization knowledge layer
- Updating AGENTS.md or a skill is heavier (affects all users/agents)
