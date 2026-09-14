---
name: inbox-reads-and-triage
description: >-
  Reading the inbox tab bar and rows, listing/searching mail with
  coverage-aware inventory envelopes, refreshing the UI after mutations, and
  bulk unread cleanup. Use when reading, searching, counting, archiving,
  starring, moving, or marking mail read, or when reporting how much of an
  inbox was covered.
---

# Inbox Reads and Triage

## Reading the inbox

`list-inbox-threads` is the inbox view itself: it returns the tab bar
(Important, pinned labels, saved filters, Other — or one combined Inbox tab
when the user has "combine inbox" on), each tab's total/unread counts, and
the active tab's rows, all computed from one partition over the synced inbox
store. A tab's badge can never disagree with the rows it returns, and the
read never waits on a live Gmail call. `tab` accepts any id from the returned
`tabs` list; an unrecognized or omitted id falls back to the first tab. Use
`list-emails`/`search-emails` for every other view (Sent, Archive, Trash, All
Mail) or an ad hoc query — not for the inbox.

Membership is Superhuman-style, not Gmail's own IMPORTANT label: a thread
shows in every pinned-label/saved-filter tab whose query it matches (a thread
can appear in more than one). A thread matching no custom tab falls to
Important, unless its latest message classifies as automated (bulk senders,
`List-Unsubscribe`, notification-style `from:`), in which case it falls to
Other. If the inbox looks stale despite this, call `resync-inbox` to force an
immediate Gmail resync instead of polling `list-inbox-threads` in a loop.

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
`archive`, `trash`, `draft-queue`, `settings`), plus `tab` (an inbox tab id
from `list-inbox-threads`; `label`/`filter` are accepted aliases),
`threadId`, `settingsSection` (`drafting`, `automations`, `gmail-filters`,
`aliases`, `ai-filter`, `tracking`, `slack`, `team`), `queuedDraftId`, or
`composeDraftId`.

## Related Skills

- `mail-backends` — whether a read hit real Gmail or the local fallback.
- `provider-api-scans` — reads beyond the canned actions, and staging large
  scans for analysis.
- `email-drafts` — replying to something you just read.
- `inbox-automations` — automating recurring triage instead of repeating it.
