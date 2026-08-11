# Mail — Agent Guide

Mail is an agent-native inbox: read and triage messages, draft and queue
replies, and update mail state through actions and application state.

## Skills

Read the relevant skill before deeper work:

- `inbox-reads-and-triage` for listing/searching mail, inventory coverage,
  refreshing after mutations, and bulk unread cleanup.
- `email-drafts` for composing, signatures, style, attachments, sending,
  scheduled sends, tracking, and aliases.
- `draft-queue` for org and Slack draft review/send workflows.
- `contacts-and-crm` for resolving recipients and CRM reach.
- `mail-backends` for real Gmail vs synthetic local fallback.
- `inbox-automations` for automation rules and Gmail-native filters.
- `provider-api-scans` for raw provider API calls and staged large scans.

## Core Rules

- Use actions for reads, labels, settings, drafts, queued drafts, filters,
  scheduling, refresh, and CRM context. Don't edit mail SQL directly unless a
  skill or action calls for it.
- Two backends, chosen automatically per user: real Gmail when a Google account
  is connected, synthetic `local-emails` data otherwise. Call actions the same
  way either way, and never claim fallback data or a fallback send touched the
  user's real inbox.
- Never send mail unless the user explicitly asks. Draft or queue for review by
  default; `send-email` is `needsApproval: true`. Use `queue-email-draft` for
  teammate or Slack-originated send requests.
- Resolve people with `find-contact` before drafting or sending. Never guess an
  address pattern; if it returns zero matches, tell the user.
- Read `get-mail-settings` before drafting. Use the configured `signature`
  exactly when present; never invent one from the user's name or profile.
- Never edit the email store to change a draft the user is currently composing;
  use `manage-draft` or the `compose-{id}` application-state key.
- After backend mail mutations (archive, trash, star, mark-read, move, send),
  call `refresh-list` unless the action itself writes `refresh-signal`.
- Inventory reads report per-account success, empty result, exhaustion, or
  error. Never describe partial account coverage as complete.
- Provider-specific actions are shortcuts, not capability limits: escalate to
  `provider-api-catalog` / `-docs` / `-request` when the exact endpoint, filter,
  pagination, or API version matters.
- `get-hubspot-contact` is the only first-class CRM action; Gong, Pylon, and
  Apollo are UI-only in Mail — say so rather than implying
  `provider-api-request` reaches them. The agent can't configure aliases or
  provider API keys (Settings UI only).
- Use `view-screen` when the active thread, message, draft, or queue item is
  unclear, and `get-thread` for conversation context rather than screen text.
- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private
  Builder/internal data, customer data, or credential-looking literals. Use
  secrets/OAuth/runtime configuration and obvious placeholders in examples.

## Action Map

| Action | Purpose |
| --- | --- |
| `search-emails` / `list-emails` | Query mail by view/query. |
| `get-email` / `get-thread` | Full body/metadata for a message or thread. |
| `find-contact` | Resolve a name/partial address to a real email. |
| `get-hubspot-contact` | HubSpot contact + deals + tickets by email. |
| `create-attachment-upload` | Short-lived upload URL for an attachment. |
| `manage-draft` | Create/update/delete a `compose-{id}` draft. |
| `send-email` | Real send; `needsApproval: true`. |
| `queue-email-draft` / `list-queued-drafts` / `update-queued-draft` / `open-queued-draft` / `send-queued-drafts` | Teammate/Slack draft review. |
| `mark-read` / `mark-thread-read` / `star-email` / `archive-email` / `unarchive-email` / `trash-email` / `untrash-email` / `move-email` | Message/thread state; `mark-read` does bulk cleanup. |
| `send-scheduled-email-now` / `cancel-scheduled-email` | Send or cancel a scheduled send. |
| `manage-gmail-filters` | Gmail-native filters. |
| `manage-automations` / `trigger-automations` | Inbox automation rules. |
| `respond-calendar-invite` | Accept/decline/tentative an invite. |
| `get-mail-settings` / `update-mail-settings` / `import-gmail-signature` | Signature and writing style. |
| `manage-snippets` | Saved reply snippets. |
| `get-tracking` | Open/click stats for a sent message. |
| `provider-api-catalog` / `provider-api-docs` / `provider-api-request` | Raw Gmail/Calendar/HubSpot API calls. |
| `refresh-list` | Make the UI refetch. |

## Application State

- `navigation` exposes inbox/thread/draft-queue views and selected ids.
- `compose-{id}` entries are open compose tabs and draft content.
- `navigate` moves the UI via `view`, `threadId`, `settingsSection`,
  `queuedDraftId`, or `composeDraftId`; the accepted values are listed in
  `inbox-reads-and-triage`.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.
