# Chat — Agent Guide

Chat is the minimal chat-first agent-native app. Chat is the primary surface;
actions carry the real capabilities, and screens exist only where a workflow
needs durable UI around the conversation.

## Skills

The default app skill surface is intentionally small. Promotion, learning,
provider, and release workflows are optional; enable the matching skill only
when this app actually uses that workflow.

**Do not add internationalization or changelog support unless the user
explicitly asks for them.** This template ships English-only UI copy inline —
no `app/i18n/`, LanguagePicker, `CHANGELOG.md`, or What's New surfaces. If the
user requests i18n or changelogs, load the matching skill and add only what they
asked for.

The `docs-search` action reads the version-matched framework docs bundled with
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
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private
  Builder/internal data, customer data, or credential-looking literals. Use
  secrets/OAuth/runtime configuration and obvious placeholders in examples.
- For external integrations, inspect the workspace/provider connection catalog
  first. Reuse an existing connection and its scoped credential resolver; only
  use app-local vault/OAuth/settings primitives when no reusable connection
  exists. Keep custom setup UI provider-specific and never duplicate storage.
- Keep actions deterministic and focused. Research, analysis, generation,
  recommendation, and synthesis start in the AgentSidebar and let the agent
  orchestrate its tools; follow-ups stay in the same thread rather than moving
  the user to a second freeform prompt box.
- Never fabricate. If an action fails or data is missing, say so and recover
  instead of inventing a result or claiming success.
- Verify a write before reporting it done — re-read the row or the screen.
- Use `view-screen` or application state when the active page/selection is
  unclear.

## Application State

- `navigation` describes the current view and selected entity ids. The default
  chat view is `chat` at `/`.
- `navigate` moves the UI when the app supports it.
- `view-screen` is the first tool to call when the user's visible context
  matters.

## Data & actions (read these first)

When adding SQL-backed features, do **not** start with `find` / `cat` over
`node_modules`. Read these two files first:

1. `server/db/schema.ts` — table definitions, migrate commands, path map
2. `drizzle/crud-action-example.ts` — copy-paste list/create/update/delete

Then use `getDb` / `schema` from `server/db/index.ts`. After a batch of related
schema/action edits: one smoke test, one `pnpm typecheck` (see
`self-modifying-code`).

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.

- Guarded verification: run `pnpm agent-native:doctor`; fix findings before done.
- For ordinary source edits, follow `self-modifying-code`: verify once per batch,
  not after every file; smoke-test new CRUD once, don't CLI-test every action.
