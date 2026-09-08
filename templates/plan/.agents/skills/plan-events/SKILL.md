---
name: plan-events
description: >-
  The four plan lifecycle events on the framework event bus and how to subscribe
  with `manage-automations` instead of bespoke integration code. Use when a user
  wants to be notified or trigger work on plan creation, comments, publishes, or
  status changes.
---

# Plan Events

The plan app emits four events on the framework event bus: `plan.created`,
`plan.commented`, `plan.published`, and `plan.status.changed`. Automations can
subscribe to any of them — if a user asks to "notify me when someone comments"
or similar, call `manage-automations` with `action=define` (trigger `plan.commented`,
optional condition on `resolutionTarget`) rather than writing bespoke integration
code. See the `automations` skill and the [Visual Plans events docs](/docs/template-plan#events)
for payload schemas and recipe examples.

## Related Skills

- **plan-comments-and-feedback** — the comment data an automation reacts to.
