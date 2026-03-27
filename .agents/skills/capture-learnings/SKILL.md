---
name: capture-learnings
description: >-
  Capture and apply accumulated knowledge via the Resources system. Use when the
  user gives feedback, shares preferences, corrects a mistake, or when you
  discover something worth remembering for future conversations.
user-invocable: false
---

# Capture Learnings

This is background knowledge, not a slash command. **Read the `learnings.md` resource before starting significant work.** Update it when you learn something worth remembering.

## How to Read & Write Learnings

Learnings are stored as **resources** in the SQL database, not as files on disk.

- **Read:** `pnpm script resource-read --path learnings.md`
- **Write:** `pnpm script resource-write --path learnings.md --content "..."`
- **List all resources:** `pnpm script resource-list`

Resources can be **personal** (per-user, default) or **shared** (team-wide):
- `pnpm script resource-write --path learnings.md --scope personal --content "..."`
- `pnpm script resource-write --path team-guidelines.md --scope shared --content "..."`

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

Write learnings as markdown, grouped by category:

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

1. **Read first, write second** — always read the `learnings.md` resource before starting work
2. **Capture immediately** — don't wait until the end of the conversation
3. **Keep it concise** — one line per learning, grouped by category
4. **Don't duplicate** — if a learning exists, refine it rather than adding another
5. **Resources are SQL-backed** — safe for personal info, preferences, contacts. They persist across sessions and are not in git.

## Organizing Resources

Learnings are just one type of resource. You can create additional resources for different purposes:
- `learnings.md` — user preferences, corrections, patterns (personal)
- `contacts.md` — important contacts and relationships (personal)
- `team-guidelines.md` — shared team conventions (shared)
- `notes/meeting-2026-03-26.md` — meeting notes (personal or shared)

Use path prefixes like `notes/`, `docs/`, etc. to organize resources into virtual folders.

## Graduation

When a learning is referenced repeatedly, it may belong in AGENTS.md or a skill:
- Updating the `learnings.md` resource is a Tier 1 modification (data — auto-apply)
- Updating a SKILL.md based on learnings is Tier 2 (source — verify after)

## Migration

If a `learnings.md` file exists at the project root (from before the Resources system), run:
```
pnpm script migrate-learnings
```
This imports the file contents into the `learnings.md` resource.

## Related Skills

- **self-modifying-code** — resource updates are Tier 1; skill updates are Tier 2
- **create-skill** — when a learning graduates, create a skill from it
