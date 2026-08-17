# Mail — Agent Guide

Mail is an agent-native inbox, drafting, triage, and draft-review app. The agent
reads messages, helps prioritize, drafts replies, manages queued drafts, and
updates mail state through actions and application state.

Detailed draft, queue, and contact-resolution patterns live in
`.agents/skills/`.

## Core Rules

- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Use actions for email reads, labels, settings, drafts, queued drafts, filters,
  scheduling, refresh, and CRM context. Do not edit mail SQL directly unless a
  skill/action explicitly calls for it.
- **Two mail backends, chosen automatically per user.** When the user has a
  connected Google account (`isConnected(ownerEmail)`), actions call the real
  Gmail API. When no account is connected, the same actions fall back
  transparently to synthetic `local-emails` data stored via `getUserSetting` /
  `putUserSetting`. Never assume Gmail is connected — actions like
  `search-emails`, `list-emails`, `get-thread`, `get-email`, and `move-email`
  branch on this internally, so call them the same way either way.
- `find-contact` (backed by `loadContactsForEmail`, cached ~a few minutes) is
  the correct way to resolve a name or partial address to an email before
  drafting or sending. It merges Google People API "connections" (boosted
  `count += 5`) and "other contacts" with real send/receive history, and is
  strictly better than guessing a `firstinitiallastname@company.com` pattern.
  Never guess an email pattern when `find-contact` returns zero matches — tell
  the user instead.
- `get-hubspot-contact` is the only first-class CRM action. Gong, Pylon, and
  Apollo have server-side lookup handlers (used by the UI's CRM sidebar) but
  are **not** wired to any agent action and are **not** in Mail's
  `provider-api-request` catalog (`MAIL_PROVIDER_API_IDS` only resolves to
  `gmail`, `google_calendar`, and `hubspot` — see `listProviderApiIdsForTemplateUse("mail")`
  in `server/lib/provider-api.ts`). If the user asks about Gong calls or Pylon
  tickets from the agent chat, say those providers are UI-only in Mail today;
  do not claim `provider-api-request` can reach them.
- Treat provider-specific actions as shortcuts, not capability limits. When the
  exact Gmail, Google Calendar, or HubSpot endpoint/filter/pagination/API
  version matters, use `provider-api-catalog`, `provider-api-docs`, and
  `provider-api-request` against the real provider API. For large scans, stage
  results with `stageAs` and analyze them with `query-staged-dataset`
  (`list-staged-datasets` / `delete-staged-dataset` manage the scratch rows).
- Never send mail unless the user explicitly asks to send. Draft or queue
  review by default. `send-email` has `needsApproval: true` — it is the
  canonical, intentionally rare use of the human-in-the-loop gate in this
  framework; the loop pauses for approval on every real send. Drafting and
  queueing are unaffected.
- When drafting, first read `get-mail-settings` for signature and writing
  style. Use `signature` exactly when present — draft-writing paths that build
  a `compose-*` entry (`manage-draft`, `open-queued-draft`) call
  `appendSignatureToBody` automatically, which is idempotent (skips if the
  signature is already present) and inserts before any quoted reply/forward
  content. Never derive a signature from the user's name or connected profile
  when none is configured.
- A request to permanently add, change, or remove a drafting/writing-style rule
  is a durable settings mutation: read `get-mail-settings`, merge the requested
  change into the existing `writingStyle` while preserving unrelated rules,
  and call `update-mail-settings` with the complete merged value. If the
  requested merge is ambiguous or conflicts with existing guidance, show the
  proposed wording and ask for confirmation first; then re-read the settings
  and confirm persistence. Do not call `manage-draft`, open compose, or create
  a draft for a settings-only request unless the user separately asks for one.
- For teammate/Slack-originated send requests, use `queue-email-draft`
  (`draft-queue` skill), not `send-email` directly. The requester and reviewer
  must both be members of the active organization; Slack intake resolves the
  sender's real email via `users.info` (requires `users:read.email` bot scope)
  before it will queue anything.
- Never edit the email store to change a draft the user is currently composing;
  use `manage-draft` or the `compose-{id}` application-state key described in
  `email-drafts`.
- After backend mail mutations (archive, trash, star, mark-read, move, send),
  call `refresh-list` so the UI refetches. Actions that already write
  `refresh-signal` internally (e.g. `mark-thread-read`, `move-email`,
  `respond-calendar-invite`) don't need a second call.
- Use `view-screen` when the active thread, selected message, draft, or queue
  item is unclear.
- Aliases (Settings → Aliases) and provider API-key connections (Gong, Pylon,
  Apollo, HubSpot) are managed only through raw `/api/*` routes from the
  Settings UI — there are no `manage-aliases` or `save-*-key` actions. The
  agent can read HubSpot data via `get-hubspot-contact` but cannot configure
  any of these connections on the user's behalf.

## Action Map

| Action                                                                                                                                 | Purpose                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `search-emails` / `list-emails`                                                                                                        | Query across Gmail or local-fallback data by view/query.                               |
| `get-email` / `get-thread`                                                                                                             | Full body/metadata for one message or thread.                                          |
| `find-contact`                                                                                                                         | Resolve a name/partial address to a real email.                                        |
| `get-hubspot-contact`                                                                                                                  | CRM contact + deals + tickets by email (HubSpot only).                                 |
| `manage-draft`                                                                                                                         | Create/update/delete a `compose-{id}` draft (signature-aware).                         |
| `send-email`                                                                                                                           | Real send. `needsApproval: true` — always pauses for human approval.                   |
| `queue-email-draft` / `list-queued-drafts` / `update-queued-draft` / `open-queued-draft` / `send-queued-drafts`                        | Teammate/Slack draft-review workflow — see `draft-queue`.                              |
| `mark-read` / `mark-thread-read` / `star-email` / `archive-email` / `unarchive-email` / `trash-email` / `untrash-email` / `move-email` | Per-message or per-thread state changes; most call `refresh-list` internally.          |
| `manage-gmail-filters`                                                                                                                 | Provider-native Gmail filters (create/replace/delete).                                 |
| `manage-automations` / `trigger-automations`                                                                                           | Natural-language inbox automation rules.                                               |
| `respond-calendar-invite`                                                                                                              | Accept/decline/tentative an invite found in Mail.                                      |
| `get-mail-settings` / `update-mail-settings` / `import-gmail-signature`                                                                | Signature and writing-style settings.                                                  |
| `manage-snippets`                                                                                                                      | List/create/update/delete saved reply snippets insertable from the compose slash menu. |
| `get-tracking`                                                                                                                         | Open/click stats for a previously sent, tracked message.                               |
| `provider-api-catalog` / `provider-api-docs` / `provider-api-request`                                                                  | Raw Gmail, Calendar, or HubSpot API calls beyond the canned actions.                   |

## Application State

- `navigation` exposes inbox/thread/draft-queue views and selected ids.
- `compose-{id}` entries represent open compose tabs and draft content (see
  `email-drafts`).
- `navigate` moves the UI: `view` (`inbox`, `starred`, `sent`, `drafts`,
  `scheduled`, `archive`, `trash`, `draft-queue`, `settings`), plus `threadId`,
  `settingsSection` (`drafting`, `automations`, `gmail-filters`, `aliases`,
  `tracking`, `slack`, `team`), `queuedDraftId`, or `composeDraftId`.
- Use `get-thread` for full conversation context instead of relying on ambient
  screen text.

## Scheduling And Automations

- Scheduled sends use job ids prefixed `scheduled-`; `send-scheduled-email-now`
  and `cancel-scheduled-email` both strip that prefix internally before
  looking up the job — pass the id as shown to the user either way.
- `manage-automations` rules match new inbound mail against a natural-language
  `condition` using AI, then apply `actions` (`label`, `archive`, `mark_read`,
  `star`, `trash`). Rules run on a per-minute cron automatically;
  `trigger-automations` forces immediate processing (debounced — a
  just-triggered run may report "skipped, try again in 30 seconds").
- Gmail filters (`manage-gmail-filters`) are a distinct, provider-native
  mechanism from automation rules — filters run inside Gmail itself, apply
  before automations, and support raw Gmail criteria/actions. Gmail has no
  filter-update endpoint: the `replace` operation works by creating a new
  filter and deleting the old one.

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
- Interactive sends require explicit user approval. Draft or queue for review by
  default; automation-triggered sends remain approval-gated unless the owner
  opts into Mail's "Allow automations to send emails automatically" setting.
  Use `queue-email-draft` for teammate or Slack-originated send requests.
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
| `send-email` | Real send; interactive calls require approval, while automation calls require the Mail opt-in setting. |
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
