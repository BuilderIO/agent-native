# Agent-Native Framework

This repository builds apps where the AI agent and UI are equal partners:
everything the UI can do, the agent can do through the same SQL data and action
surface. Keep this file small: the rules below are the invariants, and
`.agents/skills/*` carries the workflow. Read the relevant skill before changing
that area.

## Skills

`.agents/skills/` holds the deep guidance, one directory per skill, each with a
`description` naming when to read it. Read the matching skill before changing
that area — most encode a decision the surrounding code cannot show. Prefer
searching the skill directory over guessing from nearby code. When a rule here
names a skill, that skill is the authority; this file only states the invariant.

A few are entry points rather than area guides:

- `adding-a-feature` — the four-area checklist every feature must satisfy.
- `content-product-development` — read before planning, implementing,
  reviewing, testing, or documenting Content behavior or shared framework
  behavior that changes Content's product contract.
- `writing-agent-instructions` — read before editing any `AGENTS.md`,
  `SKILL.md`, or tool/action description, including this file.
- `verifying-changes` — read before reporting a fix, feature, or deploy as
  done. Exercising the path that was broken is the step most often skipped,
  and skipping it is why the same bug gets reported twice.
- `reporting-progress` — read during any run over a few minutes, and at the
  moment you are tempted to stop and ask. Chasing status is the single most
  frequent correction in this repo.
- `concurrent-agents` — read before working in a shared checkout.

Spawning a read-only investigator? Use `/sidecar <task>` instead of retyping the
contract.

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
- Worktrees are valid PR sources. When the user authorizes shipping or opening
  or updating a PR from a worktree, use that worktree's current branch and cwd
  for the commit, push, and PR operation; do not copy changes into the shared
  checkout.
- Never use `[codex]`, `codex`, or similar agent labels in user-visible GitHub
  metadata unless explicitly requested.
- On every response, consider whether the chat title still matches the work.
- Do the work instead of asking whether to do it. If a step is inside the task
  you were given and is not destructive, irreversible, or a spend/send/publish
  action, run it and report the result — deploys, database reads and writes,
  scripts, and browser checks included. Ask only for a missing credential, a
  decision only the user can make, or a destructive action. `reporting-progress`
  is the authority on what to post while long work runs and on the one legal
  shape of a mid-task stop.
- Use sub-agents liberally for complex independent work when Agent Teams are
  available; keep the main thread focused on orchestration.
- When adding package dependencies or framework integrations, verify the current
  latest version first with `npm view`/`pnpm view` or current docs. Do not rely
  on remembered versions.
- Never use `pnpm patch` or `pnpm patch-commit`, add
  `pnpm.patchedDependencies`, or commit dependency patch artifacts under
  `patches/`. Upgrade the dependency or fix app-owned code instead.
- A `catch`, default, or coercion that returns a value callers cannot
  distinguish from success is a bug, not a guard. "Absent" and "unreadable" must
  be different values; a truncated run is not a completed one; a dropped payload
  is not an empty one. This is the single habit behind the longest-running class
  of repeat user reports here: each layer coerces a failure into a clean value,
  so every layer above it reports something confidently wrong and nobody can see
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
step is still pending. Use `🔴` only when blocked on user input. When you use
`🟡`, the pending item must be legible from that one line alone — the user
should never have to reply asking what is not done.

## Checks

Rules here are carried by skills, not by blocking your tools. Two exceptions
exist, and both are narrow on purpose.

**Guards** (`pnpm guards`, and CI on every PR — these apply to Codex, Claude
Code, and a human equally). `pnpm guards --list` prints the current set;
`no-silent-coercion`, `no-raw-colors`, `no-boot-data-work`, and
`no-heavy-dashboard-list-reads` check only lines this branch added, so the
pre-existing backlog stays a separate cleanup. Each guard has a documented
opt-out pragma, and every opt-out is a decision a reviewer should see.

A guard reports three outcomes, not two: exit 0 passed, exit 1 failed, exit 2
could not run. A diff-scoped guard that cannot resolve a base ref exits 2 via
`requireAddedLines`, and `pnpm guards` renders it SKIPPED and refuses to print
"All checks passed" — in CI it fails the run. Never reintroduce an `exit(0)`
for a check that inspected nothing; that is the flagship rule above, violated
inside the thing that enforces it.

**One hook** (`scripts/hooks/file-lease.mjs`, registered in the tracked
`.claude/settings.json`): denies a write when another live session holds the
file, or when it changed on disk under you. It exists because this is the only
rule you cannot follow by reading instructions — no amount of guidance tells you
that a peer session is mid-edit in the same file right now. Re-read and build on
their change; never force past it. It is a Claude Code mechanism only: it gives
Codex sessions and plain human edits nothing, so it is a backstop, not a
guarantee. Read `concurrent-agents` before working in a shared checkout.
`guard:hooks-registered` keeps this section and that file from drifting apart.

Everything else is guidance — but guidance nobody measures is guidance nobody
can tell is working. `node scripts/agent-friction-report.mjs --weeks 2` counts
how often the user has had to repeat each correction, and names the skill that
was supposed to close it.

**Before adding a rule to this file or to a skill, run that report.** Then:

- Name the pattern key the rule is supposed to move. No key, no rule — add one
  to `PATTERNS` first, so the rule is falsifiable.
- If the pattern is climbing and already has owning guidance, do not restate
  the guidance. Rewriting a rule that has already failed twice is how this repo
  grew four copies of "push your work" across two skills while the worktree
  stayed unpushed. Replace it with a mechanism, or with one command the agent
  runs instead of remembering a procedure — `pnpm ship:push` is what that
  looks like.
- Delete the prose the mechanism replaces, in the same change.

The earlier version of this section claimed unasked branch creation "went to
zero" and used that to argue guidance beats mechanism. Measured on 2026-08-12
it was 16 in two weeks. Keep the claim and the number in the same place, or the
argument rots into exactly the patchwork it warns about.

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
  provider endpoint/filter. First-class actions are ergonomic shortcuts, not
  capability limits: when the upstream API can express an endpoint, filter,
  pagination mode, or payload, agents need a safe way to call it directly. If an
  app stores provider credentials on resource/share rows, add a scoped resolver
  that preserves those access checks before exposing raw provider requests.
- For customer or third-party provider data, never read API keys or tokens from
  `process.env`. Inspect the workspace connection catalog first, use the
  granted connection's vault-backed credential refs, and only use scoped local
  credentials when no reusable connection exists. Deployment environment
  variables are for deploy-level configuration, not user/workspace data access.
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
- Server configuration is one zod schema. Add a field under
  `packages/core/src/app-config/` and read it with `getAppConfig()`; an
  environment variable is a declared `.meta({ env })` alias into that field, not
  a parallel namespace. Consumer code never reads `process.env` — four
  resolvers do, and `configuration` names them.
- Never do heavy work at serverless cold start — migrations, backfills,
  aggregation, index builds, provider handshakes, or warmup probes in module
  load or plugin init run on every cold Lambda and surface as sitewide slowness,
  not as a slow startup. Do that work in a `recurring-jobs` task, an automation,
  or lazily behind the first request that needs it. Read `performance` before
  adding anything to a startup path.
- The agent can modify app code; design UI and data flows with that in mind.

Every feature must touch the four areas when applicable: UI, actions, skills or
instructions, and application state.

## Data And Security

- Schema changes must be additive. Never drop, rename, truncate, or destructively
  alter tables or columns in migrations or startup code.
- SQL stores structured app state, metadata, references, and searchable text. Do
  not store large raw payloads — files, images, videos, audio, PDFs, ZIPs,
  screenshots, session replay chunks, thumbnails, `data:` URLs, or base64 file
  bodies — in SQL tables, `application_state`, `settings`, or `resources`. Use
  configured file/blob storage (`uploadFile`, `putPrivateBlob`, provider object
  storage) and persist only URLs, ids, or opaque handles. See `storing-data`.
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
- One resolver per credential key, and every runtime path goes through it. Grep
  the key name before reading `process.env`, and pass the caller's email into
  shared helpers rather than resolving identity inside them. `resolveCredential`
  searches exactly one organization, so it is not a fix for a caller with no org
  (cron, CLI) or a key synced under a different org. Run
  `npx agent-native doctor --only no-env-credentials` from the app directory
  before finishing a credential change. See the `secrets` skill.
- Never create an organization, repoint a user's `active-org-id`, or migrate a
  roster/identity list into a new org on your own initiative — vault credentials
  are per-organization, so a second org orphans every key synced under the first.
  One org per workspace is the intended pattern: add members to the existing org,
  and stop and get an explicit yes before doing otherwise. See `authentication`.
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
- Data loads use layout-matching `Skeleton` geometry, not a generic "Loading..."
  label; reserve `Spinner` for brief mutations, uploads, and progress actions.
- For any user-facing UI change — including screenshot feedback, copy or density
  cleanup, settings, and control placement — read `frontend-design`.
- Default surface density is a hard default, not a judgment call. Do not add a
  page title that repeats the nav item or route, a description or subtitle under
  any title, an eyebrow, a breadcrumb beside a back arrow, a count/stat strip
  over content already on screen, or an About section in settings. A card, panel,
  tab, settings group, or row gets a title or a description, never both;
  explanation goes in a tooltip, a `Manage` popover, or a menu. Rendering a
  user's own stored `description` is content, not chrome — keep it, and render
  nothing when it is empty. Prose props are always optional; never
  `description: string`. `guard:no-default-chrome` checks lines this branch adds,
  and `templates/forms/` is the reference implementation. This is the repo's
  most-repeated correction (`text-heavy-ui`), so it is stated as a default you
  apply rather than a tradeoff you weigh: if the user wants one of these, they
  will ask.
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
- Ship a user-facing change to a template app (new capability, visible
  improvement, behavior-affecting fix)? Record it from that app with
  `agent-native changelog add "<one sentence>" --type <added|improved|fixed>`.
  Skip refactors, tooling, and tests. See the `changelog` skill.

## Extensions

Extensions are sandboxed Alpine.js mini-apps stored in SQL. When the user asks
to create or edit an extension/widget/dashboard/calculator/mini-app, use the
extension actions and `extensionData` instead of source changes. Use the
`extensions` skill for the full rules.
