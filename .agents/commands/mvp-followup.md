---
description: "Find the smallest no-bloat follow-up to finish the MVP"
argument-hint: "[focus]"
---

Use the `mvp-followup` skill.

Assess the current branch/thread for unfinished MVP work without adding product
bloat. If `$ARGUMENTS` is present, focus on that area.

Prioritize:

1. verification gaps, skipped checks, or browser QA holes
2. real-data pilot loops that have not reached review/eval
3. pending proposals, approval queues, or distillation queues
4. docs or instructions that no longer match the implementation
5. ship hygiene blocked by unrelated dirty files

Avoid proposing new integrations, dashboards, settings, abstractions, or UI
unless they directly unblock the current MVP for real users.

Return a concise recommendation. If the user explicitly asks to proceed, execute
the closeout work in parallel where safe and keep edits minimal.
