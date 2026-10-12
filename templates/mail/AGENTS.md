# Mail — Agent Guide

Mail is an agent-native inbox: read and triage messages, draft and queue
replies, and update mail state through actions and application state.

## Skills

Read relevant guides before deeper work:
- `.agents/skills/inbox-reads-and-triage/SKILL.md` — for mail listing, search, coverage, and cleanup.
- `.agents/skills/mail-interaction-parity/SKILL.md` — for parity and safe send tests.
- `.agents/skills/email-drafts/SKILL.md` — for composition, sending, scheduling, and tracking.
- `.agents/skills/draft-queue/SKILL.md` — for team draft workflows.
- `.agents/skills/contacts-and-crm/SKILL.md` — for recipients or CRM context.
- `.agents/skills/mail-backends/SKILL.md` — to distinguish Gmail from local fallback.
- `.agents/skills/inbox-automations/SKILL.md` — for AI rules and Gmail filters.
- `.agents/skills/provider-api-scans/SKILL.md` — for raw provider calls and scans.

`.agents/skills/actions/SKILL.md`, `.agents/skills/adding-a-feature/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/security/SKILL.md`,
`.agents/skills/secrets/SKILL.md`, `.agents/skills/sharing/SKILL.md`, `.agents/skills/frontend-design/SKILL.md`, `.agents/skills/shadcn-ui/SKILL.md`,
`.agents/skills/real-time-sync/SKILL.md`, `.agents/skills/context-awareness/SKILL.md`, `.agents/skills/delegate-to-agent/SKILL.md`, `.agents/skills/agent-native-docs/SKILL.md`,
`.agents/skills/agent-native-toolkit/SKILL.md`, `.agents/skills/customizing-agent-native/SKILL.md`, `.agents/skills/client-side-routing/SKILL.md`, `.agents/skills/reliable-mutations/SKILL.md`,
`.agents/skills/performance/SKILL.md`, `.agents/skills/external-agents/SKILL.md`, `.agents/skills/portability/SKILL.md`, `.agents/skills/self-modifying-code/SKILL.md`,
`.agents/skills/turn-into-skill/SKILL.md`, `.agents/skills/workspace-conventions/SKILL.md`.

## Framework Docs

Use local framework docs, not web research: `pnpm action docs-search --query "<topic>"` searches; `pnpm action docs-search --slug "<slug>"` reads a page.

## Core Rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Use actions for mail reads/writes; do not edit the mail store directly. For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.
- Use real Gmail when connected, otherwise synthetic `local-emails`; never claim fallback data changed the real inbox.
- Interactive sends require approval; draft/queue by default. Automation sends remain gated unless the owner enables Mail's setting. Use `queue-email-draft` for teammate/Slack send requests.
- Resolve recipients with `find-contact`; never guess addresses. Read `get-mail-settings` before drafting and use its signature exactly; never invent one.
- Edit active drafts through `manage-draft` or `compose-{id}`, not SQL. After backend mutations, call `refresh-list` unless the action writes `refresh-signal`.
- Preserve per-account coverage: partial, empty, exhausted, and error are distinct. Provider actions are shortcuts; use `provider-api-catalog` / `-docs` / `-request` for exact API needs.
- `get-hubspot-contact` is the only first-party CRM action; Gong, Pylon, and Apollo are UI-only. Aliases and provider API keys are Settings-UI only.
- Use `view-screen` when the active thread/message/draft is unclear; use `get-thread` for conversation content.

## Actions

| Action | Purpose |
| --- | --- |
| `list-inbox-threads` / `sync-inbox` / `resync-inbox` | Inbox inventory and sync |
| `search-emails` / `list-emails` / `get-email` / `get-thread` | Find/read messages |
| `list-labels` / `find-contact` / `get-hubspot-contact` | Labels and recipient/CRM context |
| `create-attachment-upload` | Upload attachments |
| `manage-draft` / `send-email` / `send-queued-drafts` | Manage drafts and approved sends |
| `create-scheduled-send` / `send-scheduled-email-now` / `cancel-scheduled-email` | Schedule/cancel sends |
| `queue-email-draft` / `list-queued-drafts` / `update-queued-draft` / `open-queued-draft` | Team drafts |
| `mark-read` / `mark-thread-read` / `star-email` / `archive-email` / `unarchive-email` / `trash-email` / `untrash-email` / `move-email` | Change mail state |
| `manage-gmail-filters` / `manage-automations` / `manage-email-rules` / `trigger-automations` | Filters and automation |
| `get-ai-filter` / `apply-ai-filter` / `refine-ai-filter` / `record-ai-priority-feedback` / `get-ai-priority` | AI filtering and priority |
| `respond-calendar-invite` | Reply to invite |
| `get-mail-settings` / `update-mail-settings` / `import-gmail-signature` / `manage-snippets` | Settings and snippets |
| `get-tracking` | Sent open/click stats |
| `provider-api-catalog` / `provider-api-docs` / `provider-api-request` | Direct provider APIs |
| `refresh-list` | Refetch UI |

## Application State

- `navigation` exposes inbox/thread/draft-queue views and selected ids; `compose-{id}` holds open compose tabs and draft content.
- `navigate` accepts `view`, `tab` (`label`/`filter`), `sort` (`newest`/`priority`), `threadId`, `settingsSection`, `queuedDraftId`, or `composeDraftId`.
- `settingsSection` opens `rules` or `ai-filter`.

Before building common workspace or agent UI, read `agent-native-toolkit`; for supported customization, read `customizing-agent-native`.

Search with `rg --hidden --follow`; read the exact linked guide before deeper work.
