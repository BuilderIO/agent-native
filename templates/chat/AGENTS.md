# Chat — Agent Guide

Chat is the minimal chat-first agent-native app template. Keep chat as the
primary surface, add actions for real capabilities, and add screens only when a
workflow needs durable UI around the conversation.

## Core Rules

- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Follow the root framework contract: data in SQL, actions first, application
  state for navigation/selection, and shared agent chat for AI work.
- Keep actions deterministic and focused. For research, analysis, generation,
  recommendation, or synthesis, start in the AgentSidebar and let the agent
  orchestrate its tools; keep follow-ups in the same thread instead of adding
  a second freeform prompt box.
- Keep the full-page chat route distinct from domain pages. If a workflow needs
  a page, give it a named route and use the right AgentSidebar for contextual
  AI; domain buttons that call `sendToAgentChat()` should open that sidebar.
- Keep the first viewport sparse and task-focused. Use progressive disclosure
  and domain-specific navigation, and never use sparkle, wand, magic, or robot
  icons as AI affordances.
- Page and section data loads use layout-matching `Skeleton` geometry, never a
  generic "Loading..." label. Reserve `Spinner` for brief mutations, uploads,
  and progress actions.
- Use a sans-first SaaS hierarchy with one restrained visual cue; reserve serif
  type for content previews. Give the AgentSidebar a subtle surface/divider
  boundary, and stack original/generated review vertically by default.
- Before visual work, read `frontend-design` and fill in `DESIGN.md`. Choose a
  product-fitting visual direction and palette family; do not make warm beige
  plus terracotta the default or copy a sibling app's accent automatically.
- Every AI-labeled button must call `sendToAgentChat()` with
  `openSidebar: true`; label deterministic local actions as local or preview.
- Scale effort to the task. A small, well-specified change is a short read, the
  edit, and the app's existing checks (`pnpm typecheck`, formatter, existing
  tests) — not a codebase survey, unrequested tests, or browser automation.
- Use actions for app operations and keep frontend/API parity.
- Do not add `/api/*` routes for app data. If you are about to create a file
  under `server/routes/api/`, or middleware to guard one, stop and write a
  `defineAction` instead. The only exceptions are uploads, streaming, inbound
  webhooks, OAuth callbacks, public unauthenticated URLs, and non-JSON
  responses — not auth, settings, search, or CRUD.
- Treat the chat as the default UI. When the user asks for a capability, prefer
  adding or improving the action surface first, then add a page, table, form, or
  widget only when the user needs to inspect, compare, approve, or share durable
  objects.
- If the user wants to plug in their own agent backend, keep the app shell and
  thread UI intact and adapt the chat through the framework's `AgentChatRuntime`
  connector helpers instead of forking the transcript/composer UI.
- Keep the action surface small and orthogonal: every action is a tool in the
  model's context window, so prefer one CRUD-style `update` (patch of fields)
  over many per-field actions, reach for an existing generic query / escape
  hatch (`provider-api-*`, dev `db-query`) before minting a new read action,
  mark UI-only or programmatic actions `agentTool: false` to hide them from the
  model (distinct from `toolCallable: false`, which only gates the extension
  iframe), and delete or hide actions the UI no longer uses. See the `actions`
  skill.
- Keep database code provider-agnostic and additive.
- Use `view-screen` or application state when the active page/selection is
  unclear.
- For new features, update UI, actions, skills/instructions, and application
  state when applicable.

## Application State

- `navigation` should describe the current view and selected entity ids. The
  default chat view is `chat` at `/`.
- `navigate` may be used to move the UI when the app supports it.
- `view-screen` is the first tool to call when the user's visible context
  matters.

## Framework Docs Lookup

- Before implementing or explaining non-trivial Agent Native behavior, use the
  `agent-native-docs` skill and the built-in `docs-search` action/tool to read
  the version-matched framework docs bundled with `@agent-native/core`.
- Use the built-in `source-search` action/tool, or search
  `node_modules/@agent-native/core/corpus`, when you need current core or
  first-party template implementation examples.
- Prefer those installed docs over memory or public docs when package APIs,
  generated-app conventions, workspaces, actions, or agent surfaces are involved.
- Before building common workspace or agent UI, read `agent-native-toolkit` to
  inventory existing public kits and installed package seams.
- Read `customizing-agent-native` before overriding the chat shell or shared UI.
  Keep Core thread/runtime behavior and use the supported ladder: configure →
  compose → eject the smallest presentation unit → propose a shared seam.
  Preview before `--apply` and commit `agent-native.ejections.json`.

## Skills

Read the relevant root skill before implementation: `adding-a-feature`,
`actions`, `agent-native-docs`, `agent-native-toolkit`,
`customizing-agent-native`, `storing-data`,
`real-time-sync`, `security`, `delegate-to-agent`, `frontend-design`, `shadcn-ui`, and
`self-modifying-code`.
