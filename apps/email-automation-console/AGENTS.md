# Email Automation Console — Agent Guide

Email Automation Console iterates on a scheduled daily email digest: edit the
prompt and schedule, create durable preview runs, and review them in chat. It
sends no email. Chat is the primary surface; `/automations` is the durable UI.

## Skills

- `capture-learnings` — record a user preference or correction so it outlives
  the thread.
- `docs-search` reads the version-matched framework docs bundled with
  `@agent-native/core`; `source-search` reads core and first-party template
  implementations. Prefer both over memory when package APIs, actions, or agent
  surfaces are involved.

## Core Rules

- Follow the root framework contract: data in SQL, actions first, application
  state for navigation/selection, and shared agent chat for AI work.
- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Use `view-screen` or application state when the active page/selection is
  unclear.

## Application State

- `navigation` should describe the current view and selected entity ids. The
  default chat view is `chat` at `/`.
- `navigate` may be used to move the UI when the app supports it.
- `view-screen` is the first tool to call when the user's visible context
  matters.

## Actions

The `/automations` view keeps the recurring schedule separate from manual tests
and stores each preview run in SQL.

| Action | Use |
| --- | --- |
| `get-email-automation` | Read the signed-in user's digest configuration. |
| `update-email-automation` | Patch the name, recipient, prompt, or schedule. |
| `run-email-automation-test` | Create a durable preview immediately; it explicitly sends no email. |
| `list-email-automation-runs` | Inspect recent preview runs and status fields. |

The UI's **Run test now** button saves the current draft, creates a preview,
and sends the run id to the shared agent chat for review. Do not describe a
preview as delivered. A real delivery action should remain behind explicit
human approval when this app gains a provider connection.
