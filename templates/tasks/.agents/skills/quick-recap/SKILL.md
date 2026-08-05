---
name: quick-recap
description: Use when adding or following the red/yellow/green final status block convention for agent responses, especially by installing managed AGENTS.md or CLAUDE.md instructions.
---

# Quick Recap

Make completion state obvious at the end of every response.

## Status Block

Every response that completes a unit of work must end with:

```md
🟢 Actual concise status sentence
```

Rules:

- Keep the status line under 100 characters.
- Use `🟢` when the requested work is finished.
- Use `🟡` when non-routine follow-up remains; name the pending item.
- Use `🔴` only when blocked on user input.
- Put the status line at the very end of the response.
- Do not add `---`, spacer lines, or any content after the status line.

## Installer Behavior

This convention is only automatic when it is present in project or user
instructions. When installing this skill, prefer adding the managed
`AGENTS.md` / `CLAUDE.md` block unless the user opts out.

If you are following the convention manually, choose the status from the user's
perspective: finished, pending a specific non-routine step, or blocked.

## Examples

Finished work:

```md
🟢 Updated quick recap docs with output examples
```

Non-routine follow-up remains:

```md
🟡 Code updated, set PROVIDER_WEBHOOK_SECRET before testing webhooks
```

Blocked on user input:

```md
🔴 Need the production API key to continue
```
