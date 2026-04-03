---
name: capture-learnings
description: >-
  Capture and apply accumulated knowledge in learnings.md. Use when the user
  corrects a mistake, when debugging reveals unexpected behavior, or when an
  architectural decision should be recorded for future reference.
user-invocable: false
---

# Capture Learnings

This is background knowledge, not a slash command. Read `learnings.md` before starting significant work. Update it when you discover something worth remembering.

## When to Capture

Use judgment, not rules. Capture when:

- **Surprising behavior** — Something didn't work as expected and you figured out why
- **Repeated friction** — You hit the same issue twice; write it down so there's no third time
- **Architectural decisions** — Why something is done a certain way (the "why" isn't in the code)
- **API/library quirks** — Undocumented behavior, version-specific gotchas
- **Performance insights** — What's slow and what fixed it

Don't capture:

- Things that are obvious from reading the code
- Standard language/framework behavior
- Temporary debugging notes

## Related Skills

- **self-modifying-code** — Learnings.md updates are Tier 1; skill updates are Tier 2
- **create-skill** — When a learning graduates, create a skill from it
