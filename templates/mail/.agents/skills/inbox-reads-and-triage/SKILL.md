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
store, and the read never waits on a live Gmail call. Tab badges always count
the whole tab: `unreadOnly` and `inboxFilter` narrow the returned rows, never
the counts. `tab` accepts any id from the returned `tabs` list; an
unrecognized or omitted id falls back to the first tab, except that an
`inboxFilter` read with no tab covers the whole inbox even when the All tab is
hidden. Use
`list-emails`/`search-emails` for every other view (Sent, Archive, Trash, All
Mail) or an ad hoc query — not for the inbox.

Unread and Starred are filters, not separate views. Inbox and All Mail both
have the Filter menu. The UI keeps its rules in the URL, and
`navigation.inboxFilter` holds them (`r=unread:is_checked`,
`r=starred:is_checked`, `match=any` for "either"). On the inbox, pass that
value as `list-inbox-threads` `inboxFilter` to read the rows the person sees.
Filters judge whole conversations: Starred keeps a conversation with any
starred message and Starred No one with none; Unread works the same way.
Gmail's `is:starred` and `is:unread` test single messages, so `list-emails`
`q` cannot reproduce a filtered All Mail on its own: list `view: "all"` with
`q` set to the search in parentheses followed by one Yes rule, such as
`(subject:invoice) is:starred` (`{is:unread is:starred}` for either), then
keep each conversation by all of its messages' flags. Beside a search or
label, that leaves out a conversation whose starred or unread message is not
the one that matches, as Mail does.

Starred opens All Mail filtered by Starred (`/all?r=starred:is_checked`),
because starred mail stays starred after it is archived. Unread opens the inbox
filtered by Unread (`/inbox?r=unread:is_checked`). `navigate` `starred: true`
with no `view`, `tab` or `sort` opens All Mail the same way; other
`unread`/`starred` values filter the inbox unless `view` is `all`. A
`threadId` opens that conversation inside the filtered list.

A conversation stays starred while any of its messages is. To unstar whole
conversations, call `star-email` with `threadId` (comma-separated for several)
and `unstar: true` rather than unstarring their latest messages.

Membership is independent of Gmail's IMPORTANT label: a thread belongs to its
first matching pinned-label or saved-filter tab. Unmatched personal mail goes to
Important; automated and unclassified mail goes to Other. All, when enabled,
contains every inbox thread.

During an initial sync or older-mail backfill, rows and computed tab totals are
partial; totals marked as lower bounds display with `+`. Call `sync-inbox` to
advance an initial or pending-push step. To read older mail, pass `loadOlder:
true` for one bounded page and then read `list-inbox-threads`. When the sync
result includes `retryAfterSeconds`, wait that long before the next step. A plain
`list-inbox-threads` call never starts Gmail work. Use `resync-inbox` only to
reset and restart an account's local inbox sync; it performs one bounded step.

## Gmail cooldown

A Gmail-backed read (`search-emails`, `list-emails`, `get-email`,
`get-thread`, `manage-gmail-filters`) that fails with `errorCode:
gmail_quota_cooldown` is a rate limit, not an outage. `details.retryAfterMs` and
`details.cooldownUntil` say when Gmail is ready again. Do not call any
Gmail-backed read again before then: calls inside the window are rejected
without reaching Gmail and return the same error. Report the limit as a
coverage gap, use `list-inbox-threads` (always served from the synced store) for
inbox questions, and offer to retry after the cooldown.

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

## Thread summaries

The summary card above an open email (the Summarize button, or `i`) shows what
`get-thread-summary` reads and `summarize-thread` writes, both by
`accountEmail` and `threadId`. `summarize-thread` returns the stored summary
(`cached: true`) while it covers the newest message; otherwise it spends Mail's
low-cost text model, billed as the `summary` workflow in Settings → Usage. To
answer a question about a thread, read it with `get-thread` and answer
yourself; call `summarize-thread` only when the user wants the card filled or
refreshed. `no_ai_model` means no AI provider is connected: say so instead of
retrying.

## Moving the UI

`navigate` accepts `view` (`inbox`, `all`, `sent`, `drafts`, `archive`,
`trash`, `draft-queue`, `settings`), plus `tab` (an inbox tab id
from `list-inbox-threads`; `label`/`filter` are accepted aliases),
`unread`/`starred` (above), `threadId`, `settingsSection`, `queuedDraftId`, or
`composeDraftId`. Drafts
lists requested drafts, then scheduled sends (soonest first), then the user's
own drafts; `scheduled`, and `draft-queue` without `queuedDraftId`, open it.

`settingsSection` opens Settings in the user's tab. `general`, `reading`,
`drafting`, `snippets`, `rules`, `ai-filter`, `gmail-filters`, `aliases`, and
`tracking` are tabs on Mail › General (`/settings/app/<id>`). `rules` is Mail's inbox
rules; the core Automations page is the agent's scheduled and event
automations. `slack` opens Channels › Slack, where Slack draft requests and
the agent's Slack connection live, and `members` opens Organization › Members.

## Related Skills

- `mail-backends` — whether a read hit real Gmail or the local fallback.
- `provider-api-scans` — reads beyond the canned actions, and staging large
  scans for analysis.
- `email-drafts` — replying to something you just read.
- `inbox-automations` — automating recurring triage instead of repeating it.
