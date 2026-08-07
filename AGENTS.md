# Agent-Native Framework

This repository builds apps where the AI agent and UI are equal partners:
everything the UI can do, the agent can do through the same SQL data and action
surface. Keep this file small. Put detailed workflows in `.agents/skills/*` and
read the relevant skill before changing that area.

## Always-On Rules

- Scale effort to the task. A small, well-specified change is a short read, the
  edit, and the existing checks — not a codebase survey, unrequested tests, or
  browser automation. Save deep exploration for ambiguous or cross-cutting work.
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
- A `catch`, default, or coercion that returns a value callers cannot
  distinguish from success is a bug, not a guard. "Absent" and "unreadable" must
  be different values; a truncated run is not a completed one; a dropped payload
  is not an empty one. Six weeks of repeat user reports traced back to this one
  habit — each layer coerced a failure into a clean value, so every layer above
  it reported something confidently wrong and nobody, including us, could see
  it. Prefer a loud, typed failure over a plausible-looking normal state.
- Before adding a condition to a function that already stacks several special
  cases, stop: that shape is how the same bug ships twice. Fix the boundary that
  made the special case necessary, and delete the ones it subsumes.
- Write code that reads like the surrounding code: match its comment density,
  naming, and idiom. When you do comment, comment a constraint the code cannot
  show — a non-obvious trap a future change would otherwise reintroduce — not
  what the next line does, why your change is correct, or where it came from.
- When changing docs under `packages/core/docs/content`, update the matching
  localized docs under `packages/core/docs/content/locales/*` when the source
  meaning changes. If translations cannot be updated in the same change, call
  out the specific locales that need follow-up; reviewers should flag docs
  changes that only update one language.
- Docs-only commits start with `docs: ` in the present tense, e.g.
  `docs: fix broken link in provider API guide`, not `docs: fixed broken link`.

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

## Checks

Rules here are carried by skills, not by blocking your tools. Two exceptions
exist, and both are narrow on purpose.

**Guards** (`pnpm guards`, and CI on every PR — these apply to Codex, Claude
Code, and a human equally): `no-secret-literals`, `additive-migrations`,
`no-silent-coercion`, `no-raw-colors`, alongside the existing 37. The last two
check only lines this branch added, so the pre-existing backlog stays a separate
cleanup. Each has a documented opt-out pragma, and every opt-out is a decision a
reviewer should see.

**One hook** (`scripts/hooks/file-lease.mjs`): denies a write when another live
session holds the file, or when it changed on disk under you. It exists because
this is the only rule you cannot follow by reading instructions — no amount of
guidance tells you that a peer session is mid-edit in the same file right now.
Re-read and build on their change; never force past it. Read
`concurrent-agents` before working in a shared checkout.

Everything else is guidance, because guidance is what actually worked: unasked
branch creation went to zero within days of `new-branch` gaining its activation
guard, and a tool-level block there would only have blocked the correct
post-merge workflow. When a rule keeps getting broken, the first move is to find
the situation where the agent is tempted and write the positive workflow for it
— not to add a wall.

Spawning a read-only investigator? Use `/sidecar <task>` instead of retyping the
contract.

## Architecture Contract

- Data lives in SQL via Drizzle by default. Explicit Local File Mode artifacts
  declared through `agent-native.json` may use repo files as the source of truth,
  but app state, auth, settings, and hosted/collaborative mode still use SQL.
  Keep schemas provider-agnostic.
- Keep app and template database code dialect-agnostic. Never call adapter-only
  methods such as libSQL/SQLite `run()`, `all()`, or `get()`, or PostgreSQL-only
  client APIs. Use Drizzle's shared query builder for normal reads and writes
  and `getDbExec().execute()` for reviewed portable raw SQL; keep dialect
  branching inside core database helpers.
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
  actions. If you are about to write a handler under `server/routes/api/`, or
  middleware to guard one, stop and write an action instead. The only
  exceptions are uploads, streaming, inbound webhooks, OAuth callbacks, public
  unauthenticated URLs, and non-JSON responses. Existing template `/api/*` CRUD
  is a grandfathered baseline being migrated, not a pattern to copy;
  `guard:no-action-twin-routes` fails on new ones.
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
- Treat Clay as a credentialed GTM provider API, not as a messaging channel.
  Hosted access uses `CLAY_PUBLIC_API_KEY` through the provider API substrate;
  the optional local Clay CLI/MCP plugin has a separate browser-login session
  and must not be required, auto-installed, or vendored by default. Its public
  repository currently declares no license. Use n8n and Zapier as
  automation/workflow or remote MCP connections rather than provider presets.
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
- A credential key gets exactly one resolver, and every runtime path goes
  through it. Grep the key name before reading it; if a `resolveXConfig` or
  connector already exists, call it rather than reading `process.env` again
  elsewhere. A second env-only path does not leak — it splits the app in two,
  so the settings UI reports the integration as configured while the feature
  fails claiming the env var is unset, and the error names the wrong cause.
  Shared helpers take the caller's email as a parameter; only entrypoints
  decide identity. Run `npx agent-native doctor --only no-env-credentials` from
  the app directory before finishing a credential change. See the `secrets`
  skill.
- `resolveCredential` searches exactly one organization, so it cannot read a
  shared key for a caller with no org (cron, CLI) or one synced under a
  different org. Swapping `process.env` for it looks like a fix and changes
  nothing; the doctor guard does not catch this form. For workspace-wide keys
  use a resolver that also sweeps the caller's memberships and a designated
  vault org. See the `secrets` skill.
- Never create an organization, repoint a user's `active-org-id`, or migrate a
  roster/identity list into a new org on your own initiative. Vault credentials
  are per-organization, so a second org orphans every key synced under the first
  and surfaces as a missing-key error elsewhere. One org per workspace is the
  intended pattern: add members to the existing org, and stop and get an explicit
  yes before doing otherwise. See the `authentication` skill.
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
- Every SSR HTML and React Router `.data` response is one impersonal, public
  shell, hard-cached at the CDN for every visitor. Never add `private`,
  `no-store`, `Vary: Cookie`, session/cookie reads, or auth branches to the SSR
  path — personalization is client-side after load. Enforced by
  `guard:ssr-cache-shell` and `ssr-handler.spec.ts`; do not weaken either.
- UIs should be optimistic by default: update cache and navigate immediately,
  roll back on error, and avoid click-blocking spinners except for destructive or
  irreversible operations.
- Page and section data loads use layout-matching `Skeleton` geometry, preferably
  the shared toolkit/design-system primitive. Never show a generic "Loading..."
  label for content; reserve `Spinner` for brief mutations, uploads, and
  progress actions.
- Keep template UX clean and progressively disclosed. Do not solve feedback by
  adding always-visible controls unless that is clearly the main workflow.
- Use the `frontend-design`, `shadcn-ui`, `client-side-routing`,
  `native-navigation`, `real-time-sync`, and `delegate-to-agent` skills for
  details.

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

## Skills

`.agents/skills/` holds the deep guidance, one directory per skill, each with a
`description` naming when to read it. Read the matching skill before changing
that area — most encode a decision the surrounding code cannot show. Prefer
searching the skill directory over guessing from nearby code.

Two are entry points rather than area guides:

- `content-product-development` — read before planning, implementing,
  reviewing, testing, or documenting Content behavior or shared framework
  behavior that changes Content's product contract.
- `adding-a-feature` — the four-area checklist every feature must satisfy.
- `writing-agent-instructions` — read before editing any `AGENTS.md`,
  `SKILL.md`, or tool/action description, including this file.
