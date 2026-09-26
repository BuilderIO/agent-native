# Mail — Agent Guide

Mail is an agent-native inbox: read and triage messages, draft and queue
replies, and update mail state through actions and application state.

## Skills

Read the relevant skill before deeper work:

- `inbox-reads-and-triage` for listing/searching mail, coverage, refresh, and
  bulk unread cleanup.
- `mail-interaction-parity` for the Superhuman matrix and safe send testing.
- `email-drafts` for composing, signatures, style, attachments, sending,
  scheduled sends, tracking, and aliases.
- `draft-queue` for org and Slack draft review/send workflows.
- `contacts-and-crm` for resolving recipients and CRM reach.
- `mail-backends` for real Gmail vs synthetic local fallback.
- `inbox-automations` for automation rules, AI filtering, and Gmail-native filters.
- `provider-api-scans` for raw provider API calls and staged large scans.

## Core Rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Use actions for reads, labels, settings, drafts, queued drafts, filters,
  scheduling, refresh, and CRM context. Don't edit mail SQL directly unless a
  skill or action calls for it.
- Use real Gmail when connected, else synthetic `local-emails`; call actions
  the same way and never claim fallback data touched the real inbox.
- Interactive sends require explicit approval; draft or queue by default.
  Automation sends stay approval-gated unless the owner enables Mail's "Allow
  automations to send emails automatically" setting. Use `queue-email-draft`
  for teammate/Slack send requests.
- Resolve people with `find-contact` before drafting or sending. Never guess an
  address pattern; if it returns zero matches, tell the user.
- Read `get-mail-settings` before drafting. Use the configured `signature`
  exactly when present; never invent one from the user's name or profile.
- Never edit the email store to change a draft in progress; use `manage-draft`
  or the `compose-{id}` application-state key.
- After backend mail mutations (archive, trash, star, mark-read, move, send),
  call `refresh-list` unless the action itself writes `refresh-signal`.
- Inventory reads report per-account success, empty, exhaustion, or error.
  Never describe partial coverage as complete.
- Provider actions are shortcuts; use `provider-api-catalog`/`-docs`/`-request`
  for exact endpoints, filters, or API versions.
- `get-hubspot-contact` is the only first-class CRM action; Gong, Pylon, and
  Apollo are UI-only — say so rather than implying `provider-api-request`
  reaches them. Aliases and provider API keys are Settings-UI only.
- Use `view-screen` when the active thread/message/draft/queue item is
  unclear; use `get-thread` for conversation context, not screen text.
- Store large files/blobs in configured file/blob storage, not SQL — no
  base64 or `data:` URLs in app tables, `application_state`, `settings`, or
  `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, secrets, or credential-looking literals.
  Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.

## Action Map

| Action | Purpose |
| --- | --- |
| `list-inbox-threads` | Inbox tabs, counts, and rows. |
| `resync-inbox` | Force a Gmail resync. |
| `search-emails` / `list-emails` | Search or list by view/query. |
| `list-labels` | Mailbox labels. |
| `get-email` / `get-thread` | Full message or thread. |
| `find-contact` | Resolve contacts. |
| `get-hubspot-contact` | HubSpot contact data. |
| `create-attachment-upload` | Upload attachments. |
| `manage-draft` | Manage a `compose-{id}` draft. |
| `send-email` / `send-queued-drafts` | Approval-gated sends. |
| `create-scheduled-send` | Schedule a send. |
| `queue-email-draft` / `list-queued-drafts` / `update-queued-draft` / `open-queued-draft` | Team drafts. |
| `mark-read` / `mark-thread-read` / `star-email` / `archive-email` / `unarchive-email` / `trash-email` / `untrash-email` / `move-email` | Mail state. |
| `send-scheduled-email-now` / `cancel-scheduled-email` | Scheduled sends. |
| `manage-gmail-filters` | Gmail-native filters. |
| `manage-automations` | Recurring and event-triggered automations. |
| `manage-email-rules` / `trigger-automations` | Inbox AI rules; read `inbox-automations`. |
| `get-ai-filter` / `apply-ai-filter` / `refine-ai-filter` / `record-ai-priority-feedback` | AI filtering and per-message corrections. |
| `get-ai-priority` | Optional Jev Priority sort. |
| `respond-calendar-invite` | Respond to a calendar invite. |
| `get-mail-settings` / `update-mail-settings` / `import-gmail-signature` | Mail settings. |
| `manage-snippets` | Saved replies. |
| `get-tracking` | Sent message open/click stats. |
| `provider-api-catalog` / `provider-api-docs` / `provider-api-request` | Direct provider APIs. |
| `refresh-list` | Refetch the UI. |

## Application State

- `navigation` exposes inbox/thread/draft-queue views and selected ids.
- `compose-{id}` entries are open compose tabs and draft content.
- `navigate` moves the UI via `view`, `tab` (`label`/`filter` aliases), `sort`
  (`newest` or `priority`), `threadId`, `settingsSection`, `queuedDraftId`,
  or `composeDraftId`.
- `settingsSection` opens a Settings tab: `rules` (inbox rules), `ai-filter`.

Before building common workspace or agent UI, read `agent-native-toolkit`;
read `customizing-agent-native` before adapting shared UI.
