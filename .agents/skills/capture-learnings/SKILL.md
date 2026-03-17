---
name: capture-learnings
description: >-
  Capture and apply accumulated knowledge in learnings.md. Use when the user
  gives feedback, shares preferences, corrects a mistake, or when you discover
  something worth remembering for future conversations.
user-invocable: false
---

# Capture Learnings

This is background knowledge, not a slash command. **Read `learnings.md` before starting significant work.** Update it when you learn something worth remembering.

## When to Capture

### User Preferences & Memory
- **Tone and style** — "I prefer casual tone", "don't use emojis", "keep replies short"
- **Personal context** — contacts, relationships, habits ("my wife's email is...", "I'm in PST timezone")
- **Workflow preferences** — "always CC my assistant", "I like to review before sending"
- **Corrections** — user says "no, do it this way instead" — capture the right way

### Technical Learnings
- **Surprising behavior** — something didn't work as expected and you figured out why
- **Repeated friction** — you hit the same issue twice; write it down so there's no third time
- **Architectural decisions** — why something is done a certain way (the "why" isn't in the code)
- **API/library quirks** — undocumented behavior, version-specific gotchas

### Don't Capture
- Things obvious from reading the code
- Standard language/framework behavior
- Temporary debugging notes
- Anything already in AGENTS.md or skills

## Format

Add entries to `learnings.md` at the project root. Group by category:

```markdown
## Preferences

- Prefers casual, direct tone — no corporate speak
- Always BCC assistant@company.com on client emails
- Wife's email: jane@example.com — reference as "Jane"

## Technical

- Apollo API returns null for personal Gmail addresses, only works for work emails
- HubSpot lifecycle stages are lowercase in the API but title case in the UI

## Patterns

- When drafting replies, match the sender's formality level
- For investor emails, keep it under 3 paragraphs
```

## Key Rules

1. **Read first, write second** — always check `learnings.md` before starting work
2. **Capture immediately** — don't wait until the end of the conversation
3. **Keep it concise** — one line per learning, grouped by category
4. **Don't duplicate** — if a learning exists, refine it rather than adding another
5. **learnings.md is gitignored** — safe for personal info, preferences, contacts

## Graduation

When a learning is referenced repeatedly, it may belong in AGENTS.md or a skill:
- Updating `learnings.md` is a Tier 1 modification (data — auto-apply)
- Updating a SKILL.md based on learnings is Tier 2 (source — verify after)

## Related Skills

- **self-modifying-code** — learnings.md updates are Tier 1; skill updates are Tier 2
- **create-skill** — when a learning graduates, create a skill from it
