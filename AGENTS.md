# Agent-Native Framework

This repository builds apps where the AI agent and UI are equal partners:
everything the UI can do, the agent can do through the same SQL data and action
surface. Keep this file small. Put detailed workflows in `.agents/skills/*` and
read the relevant skill before changing that area.

## Always-On Rules

- Stay on the current git branch. Never create, switch, delete, reset, rebase,
  stash, or otherwise move branches unless Steve explicitly asks for that exact
  branch operation in the current task.
- Never add `Co-Authored-By` or other agent attribution to commits.
- PRs use the current branch unless Steve explicitly requests a new branch.
  PRs are ready for review by default, not drafts, unless requested.
- Never use `[codex]`, `codex`, or similar agent labels in user-visible GitHub
  metadata unless explicitly requested.
- On every response, consider whether the chat title still matches the work.
- Use sub-agents liberally for complex independent work when Agent Teams are
  available; keep the main thread focused on orchestration.
- When adding package dependencies or framework integrations, verify the current
  latest version first with `npm view`/`pnpm view` or current docs. Do not rely
  on remembered versions.

## Final Status Block

Every final response must end with a three-line status block:

```md
---

⠀
🟢 Actual concise status sentence
```

The words after the icon are a short, task-specific status written for this
response; never use the placeholder text `Brief status` literally. Use `🟢`
when the requested coding/work unit is finished on the current branch, even if
routine commit/PR/deploy/CI remains. Use `🟡` when non-routine work or a manual
step is still pending. Use `🔴` only when blocked on user input.

## Architecture Contract

- Data lives in SQL via Drizzle by default. Explicit Local File Mode artifacts
  declared through `agent-native.json` may use repo files as the source of truth,
  but app state, auth, settings, and hosted/collaborative mode still use SQL.
  Keep schemas provider-agnostic.
- Actions are the single source of truth. Define app operations in `actions/`
  with `defineAction`; the agent calls them as tools and the frontend calls the
  shared action surface through `useActionQuery` / `useActionMutation`.
- Client code imports named helpers, hooks, or client modules instead of
  hand-writing REST calls to framework routes or template `/api/*` routes. If a
  browser workflow needs a route and no helper exists, add the helper first and
  teach that method in docs/skills instead of teaching raw `fetch`.
- Before adding any custom API or Nitro route for app data, inspect existing
  actions first. Reuse or extend the action surface instead of creating REST
  wrappers, pass-through endpoints, or duplicate CRUD routes that re-export
  actions.
- For provider integrations used in ad hoc analysis, querying, reporting, or
  cross-source research, prefer the shared `provider-api-catalog`,
  `provider-api-docs`, and `provider-api-request` action pattern from
  `@agent-native/core/provider-api` instead of hardcoding one action per
  provider endpoint/filter. This is a framework tenet: first-class actions are
  ergonomic shortcuts, not artificial capability limits. When the upstream API
  can express an endpoint, filter, pagination mode, or payload, agents should
  have a safe way to call it directly through the provider API substrate. If an
  app stores provider credentials on resource/share rows, add a scoped resolver
  that preserves those access checks before exposing raw provider requests.
- All AI work goes through the agent chat. UIs do not call LLMs directly.
- Application state belongs in SQL `application_state` so the agent can know
  the current navigation, selection, and focused object.
- Polling keeps UIs in sync through `useDbSync()` and `/_agent-native/poll`.
- The agent can modify app code; design UI and data flows with that in mind.

Every feature must touch the four areas when applicable: UI, actions, skills or
instructions, and application state.

## Plan Product Knowledge Chat

- Plan's `/` route is the Ask Plan chat surface. Use it for product and code
  questions backed by visual plans, merged PR recaps, and visual answers.
- For historical product questions like "what shipped last week", "when did this
  API change", or "what did that UI look like", call `search-pr-recaps` first.
  The default scope is merged pull requests only. Include unmerged PR recaps only
  when the user explicitly asks for unmerged or in-progress work.
- After finding a recap, call `get-visual-plan` and inspect structured blocks:
  `wireframe`, `diagram`, `api-endpoint`, `openapi-spec`, `data-model`, `diff`,
  `file-tree`, `tabs`, and `annotated-code`.
- For live code questions like "what is the API spec for this", "what does this
  look like now", or "what is the schema model for x", use `visual-answer` after
  inspecting the real code through the local repo, the Plan bridge, or GitHub.
- Before generating or updating visual content, call `get-plan-blocks` or
  `list-plan-components`. Custom components become chat-visible only after they
  are registered in the normalized schema, shared/server registry, and browser
  registry.

## Data And Security

- Schema changes must be additive. Never drop, rename, truncate, or destructively
  alter tables or columns in migrations or startup code.
- Never use `drizzle-kit push` against production databases.
- Tables with `ownableColumns()` require scoped reads and writes through
  `accessFilter`, `resolveAccess`, or `assertAccess`. Custom Nitro routes must
  establish request context before querying ownable data.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private
  Builder/internal data, customer data, or credential-looking literals in source,
  docs, tests, fixtures, screenshots, prompts, or generated extension/app
  content. Use obviously fake placeholders in examples.
- Do not copy provider tokens into apps when a workspace integration grant can be
  used. Vault/secrets own secret values; apps own app-specific readers and
  interpretation.
- Use the `security`, `storing-data`, `sharing`, `portability`, and
  `integration-webhooks` skills for implementation details.

## Frontend And UX

- TypeScript everywhere. Do not add `.js` or `.mjs` source files.
- Run Prettier on modified source files.
- Use shadcn/ui primitives for standard controls and dialogs. Do not build custom
  dropdowns/popovers/modals with absolute positioning.
- Use Tabler Icons for UI icons. Do not use emojis as first-party icons.
- No browser `alert`, `confirm`, or `prompt`; use shadcn dialogs.
- Agent prompt inputs must use the shared composer stack:
  `AgentComposerFrame`, `PromptComposer`, and `TiptapComposer`.
- Background agents must use the core run-manager / agent-teams infrastructure
  unless working on the existing local Code exception.
- Logged-in app pages can be CSR. Public/SEO pages must SSR real content.
- UIs should be optimistic by default: update cache and navigate immediately,
  roll back on error, and avoid click-blocking spinners except for destructive or
  irreversible operations.
- Keep template UX clean and progressively disclosed. Do not solve feedback by
  adding always-visible controls unless that is clearly the main workflow.
- Use the `frontend-design`, `shadcn-ui`, `client-side-routing`,
  `real-time-sync`, and `delegate-to-agent` skills for details.

## Packages And Releases

- Publishable package source changes in `packages/core`, `packages/dispatch`,
  `packages/scheduling`, or `packages/pinpoint` need a `.changeset/*.md`.
- Do not manually bump package versions; changesets handle versions on merge.
- The public template allow-list is controlled by
  `packages/shared-app-config/templates.ts` plus mirrored CLI/docs surfaces.
  Hidden templates must not appear in public catalogs unless they are explicitly
  unhidden first.

## Extensions

Extensions are sandboxed Alpine.js mini-apps stored in SQL. When the user asks
to create or edit an extension/widget/dashboard/calculator/mini-app, use the
extension actions and `extensionData` instead of source changes. Extensions can
call `appAction` for app actions/data, `dbQuery`, `dbExec`, `appFetch` for
allowed framework endpoints, and `extensionFetch` for external APIs from the
iframe bridge. Use the `extensions` skill for the full rules.

## Project Map

```txt
app/                 React frontend
actions/             App operations exposed to agent and frontend
server/              Nitro API, plugins, DB, framework routes
packages/core/       Framework runtime
packages/dispatch/   Dispatch package
packages/scheduling/ Scheduling package
templates/*/         Template apps
.agents/skills/      Detailed implementation guidance
```

## Skill Index

Read the relevant skill before making changes in that area:

- `adding-a-feature` for the four-area checklist.
- `context-xray` for inspecting and managing the live agent context window.
- `actions` for action definitions and invocation.
- `storing-data`, `portability`, `security`, `sharing` for data work.
- `performance` for keeping lists, reads, and page loads fast — column
  projection, indexing hot-path queries, and avoiding round-trip waterfalls.
- `real-time-sync`, `context-awareness`, `client-side-routing` for UI state.
- `client-methods` for browser/client APIs that must use named helpers instead
  of raw REST calls.
- `delegate-to-agent` for LLM/agent delegation.
- `visual-answer` for code/product questions answered as visual Plan artifacts.
- `harness-agents` for full agent runtimes like Claude Code, Codex, Pi,
  Cursor, or Mastra.
- `self-modifying-code` for source edits by the agent.
- `server-plugins` for `/_agent-native/*` routes and plugins.
- `authentication`, `onboarding`, `secrets` for setup/auth/credentials.
- `automations`, `recurring-jobs`, `integration-webhooks` for background work.
- `frontend-design`, `shadcn-ui` for interface work.
- `extensions` for sandboxed mini-apps.
- `observability`, `tracking`, `voice-transcription`, `a2a-protocol`,
  `external-agents`, and template-specific skills as needed.
