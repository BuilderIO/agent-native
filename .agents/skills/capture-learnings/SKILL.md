---
name: capture-learnings
description: >-
  Capture and apply accumulated knowledge via structured memory. Use when the
  user gives feedback, shares preferences, corrects a mistake, or when you
  discover something worth remembering for future conversations.
user-invocable: false
---

# Capture Learnings

This is background knowledge, not a slash command. **Your memory index is loaded at the start of every conversation.** Use `save-memory` proactively when you learn something worth remembering.

## How to Read & Write Memories

Memories are stored as **resources** in the SQL database (personal scope), not as files on disk.

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
- Anything already in AGENTS.md or skills
- Ephemeral task details (use tasks/plans instead)

## Key Rules

1. **Save proactively — don't ask permission.** When you learn something, save it immediately.
2. **One memory per topic** — e.g. `coding-style`, `project-alpha`, not one giant dump
3. **Read before updating** — if a memory exists, read it first and merge, don't overwrite
4. **Keep descriptions concise** — the index is loaded every conversation
5. **Memories are SQL-backed** — safe for personal info, persist across sessions, not in git

## Graduation

When a memory is referenced repeatedly, it may belong in AGENTS.md or a skill:
- Saving a memory is lightweight (auto-apply, personal scope)
- Updating AGENTS.md or a skill is heavier (affects all users/agents)
