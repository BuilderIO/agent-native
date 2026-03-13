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

## Format

Add entries to `learnings.md` at the project root. Match the existing format — typically a heading per topic with a brief explanation:

```markdown
## [Topic]

[What you learned and why it matters. Keep it to 2-3 sentences.]
```

## Graduation

When a learning is referenced repeatedly, it's outgrowing `learnings.md`. Propose adding it to the relevant skill or creating a new skill via `create-skill`.

- Updating `learnings.md` is a Tier 1 modification (data — auto-apply)
- Updating a SKILL.md based on learnings is Tier 2 (source — verify after)

## Related Skills

- **self-modifying-code** — Learnings.md updates are Tier 1; skill updates are Tier 2
- **create-skill** — When a learning graduates, create a skill from it
