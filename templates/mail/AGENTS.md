# Mail — Agent Guide

Mail is an agent-native inbox, drafting, triage, and draft-review app. The agent
reads messages, helps prioritize, drafts replies, manages queued drafts, and
updates mail state through actions and application state.

Detailed draft, queue, storage, sync, and UI patterns live in `.agents/skills/`.

## Core Rules

- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Use actions for email reads, labels, settings, drafts, queued drafts, filters,
  scheduling, refresh, and CRM context. Do not edit mail SQL directly unless a
  skill/action explicitly calls for it.
- Treat provider-specific actions as shortcuts, not capability limits. When the
  exact Gmail, Google Calendar, or CRM endpoint/filter/pagination/API version
  matters, use `provider-api-catalog`, `provider-api-docs`, and
  `provider-api-request` against the real provider API. For large scans, stage
  results with `stageAs` and analyze them with `query-staged-dataset`.
- Never send mail unless the user explicitly asks to send. Draft or queue review
  by default.
- When drafting, first read mail settings for signature and writing style. Use
  the configured signature exactly when present; do not invent or duplicate it.
- For teammate/Slack-originated send requests, queue a draft for the owner to
  review instead of sending directly.
- Never edit the email store to change a draft the user is currently composing;
  use `compose-{id}` application state or draft actions.
- After backend mail mutations, refresh the list state/action path so the UI
  updates.
- Use `view-screen` when the active thread, selected message, draft, or queue
  item is unclear.

## Application State

- `navigation` exposes inbox/thread/draft-queue views and selected ids.
- `compose-{id}` entries represent open compose tabs and draft content.
- `navigate` moves the UI.
- Use `get-thread` or equivalent actions for full conversation context.

## Skills

Read the relevant skill before deeper work:

- `email-drafts` for composing, signatures, style, replies, and scheduling.
- `draft-queue` for org review/send workflows.
- `actions`, `storing-data`, `real-time-sync`, `security`, `frontend-design`,
  and `shadcn-ui` for framework work.
