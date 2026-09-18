---
name: inbox-automations
description: >-
  Natural-language inbox automation rules (manage-email-rules,
  trigger-automations) and provider-native Gmail filters
  (manage-gmail-filters), including how the two differ. Use when the user asks
  to auto-label, auto-archive, auto-star, or otherwise handle incoming mail
  automatically, or to create/replace/delete a Gmail filter.
---

# Inbox Automations and Gmail Filters

## AI filter

Use `apply-ai-filter` when the user manually marks mail as unwanted or keeps a
message that was filtered. It adds or removes the reversible
`agent-native-filtered` label, archives or restores the conversation, and
records the feedback for future classification. User comments become editable
natural-language AI filter instructions; the AI filter uses Luna when
available, auto-filters only above its configured confidence threshold, and
keeps lower-confidence matches in the review queue. It never claims the
custom label is Gmail's provider-controlled Spam system label.

## Automation rules

`manage-email-rules` rules match new inbound mail against a natural-language
`condition` using AI, then apply `actions` (`label`, `archive`, `mark_read`,
`star`, `trash`). Rules run on a per-minute cron automatically;
`trigger-automations` forces immediate processing (debounced — a
just-triggered run may report "skipped, try again in 30 seconds").

## Gmail filters are a different mechanism

Gmail filters (`manage-gmail-filters`) are a distinct, provider-native
mechanism from automation rules — filters run inside Gmail itself, apply
before automations, and support raw Gmail criteria/actions. Gmail has no
filter-update endpoint: the `replace` operation works by creating a new
filter and deleting the old one.

Pick the mechanism deliberately: use a Gmail filter when the rule is
expressible in Gmail's own criteria and should apply even when this app isn't
running; use an automation rule when the condition needs natural-language
judgement.

## Related Skills

- `inbox-reads-and-triage` — one-off triage and refreshing the UI afterwards.
- `mail-backends` — Gmail filters require a connected Google account.
