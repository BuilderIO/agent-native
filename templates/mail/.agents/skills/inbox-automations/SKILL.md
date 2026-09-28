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
`condition` using AI. Label/archive/notify rules use the canonical
`kind=ai-filter` path shared with Mail AI filter settings; mark-read, star, and
trash rules keep legacy automation behavior. Mixed action sets remain legacy
rules for compatibility.

For a new AI rule, call `manage-email-rules` with `action: "create"`, one
plain-language `sentence`, and `mode: "tag" | "important" | "notify" |
"filter" | "archive"`; tag mode also takes `tagName`. The shared create path stores the
AI rule, pins tag labels as inbox tabs, and queues bounded recent-mail
application. Inspect existing rules and update a matching rule before creating
a duplicate. Update a rule with its `id`, revised `sentence`, and `mode` (and
`tagName` for a tag). The inbox-tab cog lists AI tags first; unchecking a tag
only hides its tab and never deletes its rule.

For a direct request to add or change one rule, make one `manage-email-rules`
create/update call and report its structured result. It saves the rule and
queues recent-mail application before returning; model availability and
matching run in the background. Do not call the backfill/status action or
`trigger-automations` to finish the same request. A queued result is a saved
rule with work continuing in the background, not a reason to retry the rule
mutation.

For an AI rule that marks matching mail important, use the
`agent-native-important` label without archiving. For unwanted mail, pair the
`agent-native-filtered` label with archive; a plain archive request can use the
archive action alone.

Use `notify` mode to add the `agent-native-important` label and send a core
notification for each matching new message. Recent-mail backfill applies the
highlighting label only; it never sends notifications for historical matches.
Mail's notification bell polls saved notifications while Mail is open and can
show browser system popups after permission is enabled. This isn't offline web
push. Mobile app notifications are coming soon.

For other prompt-driven actions such as auto-replies, use an event-triggered
automation on `mail.message.received`. Its payload includes `accountEmail` and
`messageId`; pass both to `get-email` to read the exact message. Mail's existing
send approval setting continues to gate automated sends.

Creating or updating an enabled AI-filter rule queues a backfill over recent
mail (at most 200 inbox threads from the last 14 days). A queued result has
`appliedCounts: null` plus `backfillRunId` and
`backfillStatus`; report it as queued, not completed. When the action returns
per-rule `appliedCounts`, report those exact counts. `settingsHref` opens Mail's
AI filter settings for review. Rules also process new inbound mail on the
per-minute cron; `trigger-automations` forces immediate processing (debounced —
a just-triggered run may report "skipped, try again in 30 seconds").

Priority sort uses enabled AI Important rules as its Jev instruction.
Use `record-ai-priority-feedback` when the user says a specific email should or
should not be important. It stores per-email important/not-important votes;
Priority treats a vote as an explicit score override for that message.

Use `refine-ai-filter` when the user supplies checked recent-email corrections
for an existing AI-filter rule. It rewrites and saves that rule's condition,
then queues the same bounded backfill and returns its run id/status and a
Settings link; do not invent correction examples or report queued work as done.

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
