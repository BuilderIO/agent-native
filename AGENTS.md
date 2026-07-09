# Agent-Native Framework

This repository builds apps where the AI agent and UI are equal partners:
everything the UI can do, the agent can do through the same SQL data and action
surface. Keep this file small. Put detailed workflows in `.agents/skills/*` and
read the relevant skill before changing that area.

## Always-On Rules

- Stay on the current git branch. Never create, switch, delete, reset, rebase,
  stash, or otherwise move branches unless the user explicitly asks for that exact
  branch operation in the current task.
- Never add `Co-Authored-By` or other agent attribution to commits.
- PRs use the current branch unless the user explicitly requests a new branch.
  PRs are ready for review by default, not drafts, unless requested.
- Never use `[codex]`, `codex`, or similar agent labels in user-visible GitHub
  metadata unless explicitly requested.
- On every response, consider whether the chat title still matches the work.
- Use sub-agents liberally for complex independent work when Agent Teams are
  available; keep the main thread focused on orchestration.
- When adding package dependencies or framework integrations, verify the current
  latest version first with `npm view`/`pnpm view` or current docs. Do not rely
  on remembered versions.
- When changing docs under `packages/core/docs/content`, update the matching
  localized docs under `packages/core/docs/content/locales/*` when the source
  meaning changes. If translations cannot be updated in the same change, call
  out the specific locales that need follow-up; reviewers should flag docs
  changes that only update one language.

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
- For composable workspace workflows, prefer many focused headless or small-UI
  mini-apps that discover and call each other over A2A instead of one oversized
  app. Pass artifact ids, URLs, and bounded summaries between apps instead of
  pasting large provider dumps through prompts. Read `composable-mini-apps`
  before designing cross-app orchestration.
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
- SQL stores structured app state, metadata, references, and searchable text. Do
  not store large raw payloads — files, images, videos, audio, PDFs, ZIPs,
  screenshots, session replay chunks, thumbnails, `data:` URLs, or base64 file
  bodies — in SQL tables, `application_state`, `settings`, or `resources`. Use
  configured file/blob storage (`uploadFile`, `putPrivateBlob`, provider object
  storage) and persist only URLs, ids, or opaque handles. In hosted or persistent
  DB mode, fail closed with setup guidance instead of falling back to SQL blobs.
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
- Run oxfmt on modified source files.
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
- When you ship a user-facing change to a template app (new capability, visible
  improvement, or behavior-affecting fix), record it from that app with
  `agent-native changelog add "<one user-facing sentence>" --type <added|improved|fixed>`.
  This writes a changeset-style pending entry under `changelog/`; `changelog
release` rolls pending entries into the app's `CHANGELOG.md`, which renders in
  the command menu (Cmd+K → "What's new") and settings. Skip refactors, tooling,
  and tests. See the `changelog` skill.

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
- `data-programs` for stored, cached data-source scripts bound to app panels.
- `storing-data`, `portability`, `security`, `sharing` for data work.
- `audit-log` for the automatic action-level audit trail (who changed what,
  when, agent vs human) and the scoped `list-audit-events` read surface.
- `performance` for keeping lists, reads, and page loads fast — column
  projection, indexing hot-path queries, and avoiding round-trip waterfalls.
- `reliable-mutations` for writing data so it persists under the hosted run
  budget — one atomic call, never loop many small writes, verify and report
  proof-of-done, fail loud on cutoff.
- `real-time-sync`, `context-awareness`, `client-side-routing` for UI state.
- `client-methods` for browser/client APIs that must use named helpers instead
  of raw REST calls.
- `delegate-to-agent` for LLM/agent delegation.
- `agent-native-toolkit` for deciding whether settings, app chrome,
  collaboration, sharing, navigation, organization, comments, or history belong
  in reusable framework/toolkit primitives.
- `composable-mini-apps` for many one-job headless apps that discover siblings
  and compose through `invoke` / `call-agent`.
- `visual-answer` for code/product questions answered as visual Plan artifacts.
- `harness-agents` for full agent runtimes like Claude Code, Codex, Pi,
  Cursor, or Mastra.
- `self-modifying-code` for source edits by the agent.
- `upgrade-agent-native` for bringing an older app/workspace to current
  `@agent-native/*` packages without patching core/dispatch.
- `upgrade-agent-native` for bringing an older app/workspace to current
  `@agent-native/*` packages without patching core/dispatch.
- `server-plugins` for `/_agent-native/*` routes and plugins.
- `authentication`, `onboarding`, `secrets` for setup/auth/credentials.
- `automations`, `recurring-jobs`, `integration-webhooks` for background work.
- `frontend-design`, `shadcn-ui` for interface work.
- `changelog` for the per-app user-facing "What's new" CHANGELOG workflow.
- `extensions` for sandboxed mini-apps.
- `generative-ui` for transient or persisted sandboxed inline chat UI.
- `observability`, `tracking`, `voice-transcription`, `a2a-protocol`,
  `external-agents`, and template-specific skills as needed.
