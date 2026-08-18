---
name: inbox-reads-and-triage
description: >-
  Listing and searching mail with coverage-aware inventory envelopes, refreshing
  the UI after mutations, and bulk unread cleanup. Use when reading, searching,
  counting, archiving, starring, moving, or marking mail read, or when reporting
  how much of an inbox was covered.
---

# Inbox Reads and Triage

## Coverage-aware inventory reads

`list-emails` remains the compatibility list action for the UI and internal
callers. External MCP callers receive its structured inventory envelope by
default (or pass `format: "inventory"`). Inventory reads use `accountEmails`
for an explicit set; the legacy singular `account` alias cannot be combined
with it. The response reports each account's success, empty result, exhaustion
or bounded error, so partial coverage must never be described as complete.
Inventory items are intentionally compact metadata only — use `get-email` or
`get-thread` only after selecting a specific result when body content is
needed.

## Refresh after mutations

After backend mail mutations (archive, trash, star, mark-read, move, send),
call `refresh-list` so the UI refetches. Actions that already write
`refresh-signal` internally (e.g. `mark-thread-read`, `move-email`,
`respond-calendar-invite`) don't need a second call.

## Bulk unread cleanup

For broad unread cleanup in one account, call `mark-read` once with
`scope: "all-unread"`, the exact `accountEmail`, and any protected
conversation IDs in `excludeThreadIds`. Do not loop `mark-thread-read` over
many conversations. The bulk result's matched, excluded, changed, failure,
and remaining-unread counts are the proof of completion.

## Knowing what the user is looking at

Use `view-screen` when the active thread, selected message, draft, or queue
item is unclear. Use `get-thread` for full conversation context instead of
relying on ambient screen text.

## Moving the UI

`navigate` accepts `view` (`inbox`, `starred`, `sent`, `drafts`, `scheduled`,
`archive`, `trash`, `draft-queue`, `settings`), plus `threadId`,
`settingsSection` (`drafting`, `automations`, `gmail-filters`, `aliases`,
`tracking`, `slack`, `team`), `queuedDraftId`, or `composeDraftId`.

## Related Skills

- `mail-backends` — whether a read hit real Gmail or the local fallback.
- `provider-api-scans` — reads beyond the canned actions, and staging large
  scans for analysis.
- `email-drafts` — replying to something you just read.
- `inbox-automations` — automating recurring triage instead of repeating it.
