# @agent-native/core

## 0.61.0

### Minor Changes

- 96a0668: Add source-aware Builder database foundation: derive the real Builder space name via the Admin GraphQL API and surface it (plus the connected spaces) through the Builder status route and `useBuilderStatus`, with non-blocking, cached lookups so the connect-flow polling never blocks on Builder.

  Builder deploy credentials remain blocked from impersonating signed-in users in hosted production. Local development can explicitly opt into env-key fallback for Builder dogfooding with `AGENT_NATIVE_LOCAL_BUILDER_ENV=1`; the escape hatch is non-production only.

## 0.60.0

### Minor Changes

- ca3efcf: Add `agent-native agent`, `agent-native agents list`, the `/_agent-native/agents` discovery route, and read-only share links for agent chat threads with bounded run summaries.
- ca3efcf: Add a headless `agent-native create --headless` scaffold for primitive-first action apps, with `--template=headless` and legacy `--template=blank` routing to the same action-only starter.

### Patch Changes

- ca3efcf: Add the Chat template as the public minimal app on-ramp and keep Starter as a legacy CLI alias.
- ca3efcf: Allow Agent-Native Code to run through the local Codex CLI when Codex is signed in, and update provider copy to mention Codex CLI auth.
- ca3efcf: Load integration prompt resources in compact mode so Slack, email, and webhook runs do not inline full skill or memory context.
- ca3efcf: Add composable mini-apps guidance to workspace agent instructions and synced workspace-core skills so generated workspaces teach sibling discovery, A2A invocation, and provider-api composition patterns.
- ca3efcf: Add Dispatch automation status controls backed by jobs markdown resources.
- ca3efcf: Fix active chat follow-up queueing so ordinary sends during a running turn stay queued, keep the thinking indicator attached to the active response, retry any fresh user turn — queued follow-ups and normal sends fired shortly after the previous run finished — through transient 409 active-run conflicts instead of reconnecting to the prior run (which replayed its answer, dropped the new message, and corrupted thread history), while still letting genuine internal continuations resume the active run, and stabilize built-in data widget renderers to avoid chart remount loops.
- ca3efcf: Add GitHub repository file helpers to the provider-api runtime, plus agent/headless tools and a reusable action factory for listing, searching, reading, writing, and deleting files through GitHub connector credentials or `GITHUB_TOKEN`.
- ca3efcf: Add a headless A2A invocation primitive for calling agent-native apps by id, name, or URL, wired through the `agent-native invoke` CLI command.
- ca3efcf: Expose an action-only package subpath and teach generated action templates to use it so fresh headless apps can run actions without installing browser UI peers.
- ca3efcf: Ship version-matched framework docs as an explicit agent-readable package guide and point generated apps at `docs-search`.
- ca3efcf: Close the notifications popover correctly over extension iframes.
- ca3efcf: Auto-join existing signed-in users into organizations whose allowed domain matches their email, and activate the newly joined org immediately.
- ca3efcf: Render read-only thread share links as sanitized HTML for browser callers while
  preserving the JSON response for API clients.
- ca3efcf: Improve RTL rendering for visual plan rich markdown and diagram blocks.
- ca3efcf: Pre-optimize core client dependencies during monorepo dev so chat-heavy apps avoid Vite optimized-dependency reloads during navigation.

## 0.59.1

### Patch Changes

- e151605: Fix active chat follow-up queueing so ordinary sends during a running turn stay queued, keep the thinking indicator attached to the active response, retry any fresh user turn — queued follow-ups and normal sends fired shortly after the previous run finished — through transient 409 active-run conflicts instead of reconnecting to the prior run (which replayed its answer, dropped the new message, and corrupted thread history), while still letting genuine internal continuations resume the active run, and stabilize built-in data widget renderers to avoid chart remount loops.
- e151605: Close the notifications popover correctly over extension iframes.
- e151605: Auto-join existing signed-in users into organizations whose allowed domain matches their email, and activate the newly joined org immediately.
- e151605: Pre-optimize core client dependencies during monorepo dev so chat-heavy apps avoid Vite optimized-dependency reloads during navigation.

## 0.59.0

### Minor Changes

- d3e0239: Reliably deliver the first agent-chat message on a cold start (buffer it until a
  chat thread exists instead of dropping it), and gate prompt boxes up front when
  no provider key, Builder connection, or BYOK key is configured. New exports:
  `useAgentEngineConfigured`, `BuilderSetupCard`, `parseSubmitChatMessage`.

## 0.58.5

### Patch Changes

- a832c55: Fix intermittent 404s on `/_agent-native/actions/*` (and other framework routes)
  on serverless deploys. Routes are registered inside an async plugin init that
  Nitro v3 does not await, and the production Nitro dispatcher snapshots its
  middleware list once at the start of h3's `handler()` — so the readiness-gate
  middleware, which runs inside that snapshot, could await init yet still fall
  through to a bare 404 (surfaced in the client as a `true` error toast) for a
  request that arrived on a cold isolate. The readiness wait now also runs as a
  Nitro `request` hook, which h3 awaits before route + middleware resolution, so
  late-registered routes exist by the time routing happens. The existing
  middleware gate is retained as a fallback.

## 0.58.4

### Patch Changes

- f16980e: Replace the agent chat loading text with a shimmering Agent Native logo lockup
  with an animated ellipsis, and attach scoped chat context badges directly above
  the composer.
- f16980e: Close the current Agent Sidebar chat tab when clearing chat into a replacement.
- f16980e: Fix active chat follow-up queueing so ordinary sends during a running turn stay queued, keep the thinking indicator attached to the active response, and stabilize built-in data widget renderers to avoid chart remount loops.
- f16980e: Expose agent-chat plugin options for skipping first-turn workspace inventory and sending a compact starter tool catalog that expands from tool-search results.
- f16980e: Improve Plan block layout resilience for positioned diagrams and tabbed code surfaces.
- f16980e: Prevent org-visible resources from being saved without an organization, and let Plan visual recaps resolve the publisher's active org when an older token lacks org context.
- f16980e: Add Plan visual-answer publishing helpers and pass merged PR metadata through PR visual recap publishing.
- f16980e: Render native data widgets even when `render-data-widget` echoes truncated JSON.
- f16980e: Soften the shared chat composer surface color.

## 0.58.3

### Patch Changes

- bb38b6f: Harden core tool argument parsing, JSON Schema handling, and tool error surfacing.

## 0.58.2

### Patch Changes

- 2c3fcb9: Improve native chat widget guidance and attachment handling so agents render structured data natively and preserve SVG/reference uploads correctly.
- 2c3fcb9: Fix SVG chat attachment handling so vector uploads are treated as file references instead of malformed vision image parts.

## 0.58.1

### Patch Changes

- a2992cb: Implement `AUTH_DISABLED` so local dev, preview, and demo deployments can skip login/signup and run all requests as a shared `dev@local.test` user.

## 0.58.0

### Minor Changes

- 9e20092: Add public OpenAI Responses, OpenAI Agents SDK, AG-UI, Claude Agent SDK, and Vercel AI SDK connector helpers for `AgentChatRuntime`.

### Patch Changes

- 9e20092: Add a public "Harness Agents" docs page documenting the `AgentHarness` substrate (`@agent-native/core/agent/harness`): built-in Claude Code / Codex / Pi adapters, `registerBuiltinAgentHarnesses`/`resolveAgentHarness`/`startAgentHarnessRun`, resumable SQL-backed sessions, host tools and permission modes, event translation, background-run surface, and custom adapters.

## 0.57.0

### Minor Changes

- 3446e34: Implement AgentChatRuntime factories and AssistantChat runtime mounting for BYO agent chat transports.

### Patch Changes

- 3446e34: Hide Pi from the interactive skill instruction picker because the shared `.agents` target already covers Pi-compatible skills.
- 3446e34: Make `plan local check` catch every required `checklist`/`question-form` field
  the Plan renderer enforces, not just per-item `id`. Previously a local plan
  missing a checklist item `label`, or a question `title`/`mode`, or an option
  `label`, passed `plan local check` with a false green and then got stuck on
  "Loading plan" when the hosted renderer rejected it (`expected string`). The
  lint now validates `id` + `label` on checklist items and options, and `id` +
  `title` + a valid `mode` enum on questions, so authoring mistakes surface
  locally before the browser handoff. The visual-plan/visual-recap skills now
  spell out the full required-field set.
- 3446e34: Accept `agent-native plan serve` as a compatibility alias for `agent-native plan local serve`.
- 3446e34: Fix the plan plugin docs to teach the canonical `plan local serve` command for local-files preview (it previously taught `plan local preview`, which runs a different local dev-server route), and note the `plan serve` short alias.

## 0.56.1

### Patch Changes

- e3e8515: Preserve native chat widget registrations when packaged apps are bundled for deployment.

## 0.56.0

### Minor Changes

- 78687a1: Add an explicit native tool-render registry plus built-in chat data table and
  chart widgets, with same-app widget action links that navigate through the
  shared chat view-transition path. Add an app chat option for typed-action-only
  agent surfaces that disables raw database tools while preserving rich native
  widget rendering from action results. Add server-safe helpers for constructing
  typed data widget action outputs.

### Patch Changes

- 78687a1: Clarify the Getting Started docs: restore per-template doc links in the grouped
  template list, remove the duplicated `create` command block from the
  add-apps section, and move "Common next moves" to the end so the page closes on
  next steps instead of mid-page.
- 78687a1: Relax hero chat composer padding for a roomier full-page chat input.
- 78687a1: Add provider API corpus recipes and provider corpus job source summaries so agents can audit which raw provider record body a broad search actually covered.
- 78687a1: Simplify the missing AI connection prompt and render it below the chat composer.

## 0.55.0

### Minor Changes

- 364e4be: Add reusable chat-home and chat view-transition primitives for chat-first apps,
  including centered empty-state layout, sidebar storage-key sharing, and opt-in
  sidebar reopening while active chats continue across route handoffs.
- 364e4be: Add an explicit native tool-render registry plus built-in chat data table and
  chart widgets, with same-app widget action links that navigate through the
  shared chat view-transition path. Add an app chat option for typed-action-only
  agent surfaces that disables raw database tools while preserving rich native
  widget rendering from action results.

### Patch Changes

- 364e4be: Chat: stop re-probing the server for a thread that already returned 404. The
  mount-time restore effect now caches known-absent thread ids for the page
  session, so navigating between routes no longer re-spams
  `GET /_agent-native/agent-chat/threads/:id` with 404s for a freshly created,
  not-yet-sent chat. Behavior is unchanged otherwise — a missing thread still
  falls back to an empty chat.
- 364e4be: Harden local Plan cold starts by validating checklist/question-form IDs, writing local serve URLs to `.plan-url`, adding headless bridge verification, and documenting Chromium/Safari guidance.
- 364e4be: Polish the skills CLI auth transcript so embedded connect output renders as one Clack guide block and shows spinner feedback during slow auth startup.
- 364e4be: Include tripwire abort text in processor result hooks and harden local plan repo-path containment against symlinks.

## 0.54.1

### Patch Changes

- cc1e11c: Fix workspace dev gateway losing the app prefix on root-relative redirects (e.g. Google OAuth flows). Path-only redirect `Location` headers are now rewritten to include the `/{app.id}` mount prefix, matching the repo `dev-lazy` gateway.

## 0.54.0

### Minor Changes

- f81e032: Add optional `outputSchema` to `defineAction` — validate an action's RETURN
  value (warn/strict/fallback). Pass a Standard Schema-compatible `outputSchema`
  (Zod, Valibot, ArkType — same surface as the input `schema`) and the framework
  validates the result AFTER `run()` resolves, composing with the existing input
  validation (input validated before `run`, output validated after). The
  `outputErrorStrategy` (default `"warn"`) controls the mismatch behavior:
  `"strict"` throws a clear error so a buggy action surfaces loudly, `"warn"`
  `console.warn`s the issues and returns the ORIGINAL result unchanged
  (non-breaking), and `"fallback"` returns the provided `outputFallback`. When no
  `outputSchema` is supplied, behavior is byte-for-byte unchanged (no wrapping).
  Borrowed from Mastra/Flue structured-output and kept dependency-free on the
  action layer.
- f81e032: Add an in-loop processor seam (`processOutputStream` / `processOutputStep` +
  `abort()` / `TripWire`) for real-time guardrails. `runAgentLoop` now accepts an
  optional `processors: Processor[]`. Each processor exposes optional hooks —
  `processOutputStream` (per streamed chunk), `processOutputStep` (once per model
  response, around tool execution, with the requested tool calls), and
  `processOutputResult` (once at run end) — and a per-processor mutable `state`
  that persists across hooks and is isolated between processors. A processor can
  call `abort(reason, meta?)` (throws an exported `TripWire`) to halt the run
  gracefully; the loop catches it, emits a new `{ type: "tripwire"; reason;
processor? }` agent-chat event, surfaces the reason as a final message, and
  stops. This is the structural prerequisite for real-time guardrails and a
  proof-of-done / coverage gate. Borrowed from Mastra's output processors and
  kept loop-internal configuration (processors only observe/mutate-stream/abort;
  they do not define app behavior or replace actions). When no processors are
  passed the loop is byte-for-byte unchanged with zero overhead.
- f81e032: Add token-efficient web content fetching for agents. `web-request` and `provider-api-docs` can now return extracted markdown, plain text, metadata, links, or bounded search matches instead of raw HTML, and `run-code` exposes `webRead()` plus pass-through options on `webFetch()` for compact web/document reduction.

### Patch Changes

- f81e032: Docs: document the agent-runtime features added since the first docs sweep.
  New pages: Human-in-the-Loop Approvals (`needsApproval` gate + `approval_required`
  / `approvedToolCalls` flow), Observational Memory (background three-tier
  compaction with `AGENT_NATIVE_OM_*` config), In-Loop Processors (the
  `processOutput*` guardrail seam + `TripWire` / `tripwire` event), and Durable
  Resume (tool-call journal — prompt note + tool-layer hard-block against
  re-running completed side effects). Folded action `outputSchema` /
  `outputErrorStrategy` and the `needsApproval` gate into the Actions page, and
  added an optional OpenTelemetry-spans section to Observability. All wired into
  the docs sidebar nav; no runtime behavior changes.
- 9909dcc: Avoid bundling native canvas from web content extraction in template SSR builds.
- f81e032: Allow the hosted Plan local-files UI to read the localhost bridge in Chromium by
  answering Private Network Access preflights.
- f81e032: Include repo-relative paths in direct local Plan preview URLs so local Plan app
  routes can reopen and edit MDX folders from the current repository.
- f81e032: Improve provider corpus jobs with a read-only status/results action helper and better multi-term snippet windows for durable provider searches.
- f81e032: Add app/template and agent-native-specific app/template properties to Better Auth signup tracking events.
- f81e032: Add VS Code extension open URLs to MCP open-link metadata.

## 0.53.0

### Minor Changes

- 5a57b60: Add a first-class evals primitive and an `agent-native eval` CLI runner that
  doubles as a CI deploy gate. Define test cases with `defineEval({ name, input,
scorers, threshold })` and compose scorers with the Mastra-style 4-step
  pipeline `createScorer({ preprocess, analyze, generateScore, generateReason })`.
  Built-in scorers ship for the common cases — `exactMatch`, `contains`,
  `usesTool`, and a provider-agnostic `llmJudge` (the judge model is resolved
  from the engine registry, never hardcoded). The runner discovers `**/*.eval.ts`
  and `evals/*.ts`, actually runs the agent loop for each input, scores the
  output, prints a readable scored table (or `--json` for CI), and exits
  non-zero when any eval scores below its threshold. Results are written to the
  observability eval store, with a documented seam for future live sampled
  scoring of production traffic through the same scorers.
- 5a57b60: Add opt-in per-action human-in-the-loop approvals. Actions can now declare
  `needsApproval` (a boolean or an `(args, ctx) => boolean | Promise<boolean>`
  predicate) on `defineAction`. When the gate resolves truthy, the agent loop does
  NOT execute `run()`: it emits an `approval_required` event carrying the tool
  name, a compact view of the input, and a stable `approvalKey`, then pauses the
  turn. A human approves by re-issuing the turn with that key in
  `AgentChatRequest.approvedToolCalls`, which lets the specific call run. The gate
  is default-off and fail-closed (a throwing predicate requires approval). The
  mail template's `send-email` action opts in as the canonical example.
- 5a57b60: Add the core of Observational Memory (OM): background compaction of a long
  agent thread into a dated, three-tier context (recent raw messages → dense
  "observations" → higher-level "reflections") so long-running threads cost far
  fewer tokens and stay prompt-cache stable.

  This ships the store (a new ownable, dialect-agnostic `observational_memory`
  table + additive migrations), the Observer and Reflector compaction passes
  (provider-agnostic internal agent calls — no hardcoded model), the
  `maybeCompactThread` compactor entry point, and the `buildObservationalContext`
  read API returning the three tiers ready for prompt injection, all exported
  from `@agent-native/core/agent/observational-memory`.

  The read API and compactor are intentionally not yet wired into the agent loop:
  injecting `buildObservationalContext` output into `production-agent.ts` (and
  registering the migration plugin in the default plugin set) is a follow-up so it
  does not collide with concurrent agent-loop changes. The store creates its table
  lazily on first use, so OM is fully functional in the meantime.

- 5a57b60: Wire Observational Memory into the agent loop (compaction + long-thread context
  injection). The OM migration plugin is now registered alongside the other
  framework migration plugins so its table is created on startup. After a clean
  turn the loop runs a best-effort, fire-and-forget compaction pass
  (`maybeCompactThread`) so long threads accrue dated observations and
  reflections. On subsequent turns, threads that have already crossed the
  compaction threshold get their reflections+observations folded in as a leading
  context block while the recent raw-message window is preserved verbatim - short
  threads with no OM entries are left byte-for-byte unchanged.
- 5a57b60: Add `agent-native add <kind> [name|url]`, a blueprint installer. Instead of
  scaffolding files, it prints a curated Markdown integration blueprint to stdout
  so you can pipe it into your own coding agent (`agent-native add provider stripe
| claude`). A URL instead of a name emits a generic research-and-integrate
  blueprint with the URL as the research seed. Ships seeded blueprints for
  provider-api integrations, inbound channel adapters, custom sandbox adapters,
  and multi-surface actions; `--list` browses what's available.

### Patch Changes

- 5a57b60: Fix hosted skills install flows for Codex plus Claude Cowork client selections and make MCP connect polling handle structured device-code failures consistently.
- 5a57b60: Add an optional OpenTelemetry export to the agent loop. `instrumentAgentLoop`
  now wraps the run, each tool call, and the model call in OTel spans
  (`agent.run`, `tool.call`, `llm.call`) carrying tool name, model, token usage,
  and error attributes. The export is fully no-op unless a host installs
  `@opentelemetry/api` (a new optional dependency) and registers a tracer
  provider, so there is zero overhead by default and no heavy SDK is added to
  core.
- 5a57b60: Add a hard delegation-depth guardrail so sub-agents cannot infinitely spawn
  sub-agents. Each sub-agent now carries its delegation depth (top-level chat is
  0); `spawnTask` refuses server-side once a spawn would exceed the cap, returning
  a clear "Delegation depth limit reached" error to the parent agent. Enforcement
  lives in `agent-teams.ts` and reads the spawning agent's depth from the ambient
  run context, so it holds even if the team tool is not stripped. The cap defaults
  to 2 and is configurable via the `AGENT_NATIVE_MAX_SUBAGENT_DEPTH` env var
  (parsed and clamped, falling back to the default on invalid values).
- 5a57b60: Document four newly-landed framework features in the published docs content:
  pluggable sandbox adapters for the `run-code` tool (`SandboxAdapter`,
  `AGENT_NATIVE_SANDBOX`, `registerSandboxAdapter`), the first-class evals CI gate
  (`defineEval`, `createScorer`, built-in scorers, and the `agent-native eval`
  command), the sub-agent delegation depth guard
  (`AGENT_NATIVE_MAX_SUBAGENT_DEPTH`), and the `agent-native add` blueprint
  installer. Adds `sandbox-adapters`, `evals`, and `blueprint-installer` pages, a
  delegation-depth section in the Agent Teams doc, and surgical pointers in the
  harness-agents, observability, and external-agents skills.
- 5a57b60: Add an opt-out for agent-chat MCP mounting so apps can provide a dedicated stable MCP route.
- 5a57b60: Surface the current sub-agent delegation depth in the runtime-context prompt.
  The chat plugin now reads the ambient delegation depth and passes it into
  `buildRuntimeContextPrompt`, so a sub-agent already at the delegation cap is
  told it cannot spawn further sub-agents. The cap was already enforced
  server-side; this only makes it visible to the model.
- 5a57b60: Tool-call journal hard-block: skip re-executing journaled-complete tool calls on
  resume. The per-turn tool-call journal (derived from the durable run-event
  ledger) previously only added a prompt-level "already completed, don't re-run"
  note. The agent loop now enforces this at the tool layer: when a non-read-only
  tool call's exact (tool name + input) already completed in an earlier
  interrupted chunk of the same turn, `runToolCall` returns the recorded result
  instead of re-executing the side effect, while still emitting the normal
  tool_start/tool_done so the transcript stays coherent. Fresh calls with no prior
  completed journal entry are unaffected.
- 5a57b60: Add a per-turn tool-call journal that hardens the run-resume path against
  duplicate side effects. When a run resumes after an interruption (gateway or
  transport drop, cold start, or soft-timeout auto-continue), the journal is
  derived from the existing run-event ledger and injected into the resume nudge:
  tool calls that already completed are listed with their results and flagged as
  "do NOT re-run", and any tool call that started but never recorded a result is
  surfaced as "interrupted / unknown outcome" so the model can decide rather than
  blindly re-executing (e.g. re-sending an email or re-creating a ticket). The
  journal is read-only over the ledger (no new recording hook), best-effort, and a
  no-op for turns with no completed or interrupted tool calls, so normal resumes
  are unchanged.

## 0.52.0

### Minor Changes

- 9dc6ba7: Add a pluggable sandbox-adapter seam for the `run-code` tool. The
  code-execution sandbox now runs behind a `SandboxAdapter` interface so the
  execution backend can be swapped without changing agent code, the localhost
  bridge, the env scrub, or output formatting. The default
  `LocalChildProcessAdapter` preserves the existing spawned child-process behavior
  byte-for-byte. A different backend (e.g. a Docker or remote/durable runner) can
  be plugged in via `registerSandboxAdapter()` or the `AGENT_NATIVE_SANDBOX` env
  var — the documented lever for exceeding the hosted execution ceiling on long
  jobs.

### Patch Changes

- 9dc6ba7: Polish the shared skills CLI prompts, standalone catalog, and install summary.
  Add MCP install support for more local agent clients and keep the PR Visual
  Recap GitHub Action prompt available in local-files mode.
- 9dc6ba7: Store pasted agent chat provider API keys in scoped encrypted app secrets instead of deployment env vars.

## 0.51.15

### Patch Changes

- ef16690: Open local Plan previews from local-files mode and clarify plugin installs use hosted Plans by default.

## 0.51.14

### Patch Changes

- cb49d6f: Keep Plan install mode flags scoped to Plan skills when the public skills CLI delegates extra text-skill copies.

## 0.51.13

### Patch Changes

- 49685d9: Fix the shared skills CLI picker so the standalone skills package installs with
  its matching core runtime, defaults public skills visibly, asks the Plan storage
  mode before client setup, and avoids duplicate Claude Code client choices.
  The hosted Plans option now also calls out that it is 100% free and open
  source.

## 0.51.12

### Patch Changes

- 7a6b32b: Fix the shared skills CLI picker so the standalone skills package installs with
  its matching core runtime, defaults public skills visibly, asks the Plan storage
  mode before client setup, and avoids duplicate Claude Code client choices.

## 0.51.11

### Patch Changes

- 914c8db: Unify the skills CLI flow so `@agent-native/skills` delegates normal user-facing
  list/add flows to the core skills CLI with an expanded public skills catalog,
  while `agent-native skills` keeps the Agent Native-only catalog.

## 0.51.10

### Patch Changes

- 14ea897: Harden local Plan block authoring guidance and align the standalone skills CLI with hosted, local-files, and self-hosted Plan modes.

## 0.51.9

### Patch Changes

- 077d67f: Add a no-auth `agent-native plan blocks` command and teach local Plans skills to
  use it before authoring local MDX.

## 0.51.8

### Patch Changes

- 0aa83d7: Only report assistant UI recovery errors to Sentry after the retry budget is exceeded.
- 0aa83d7: Clarify Plans skill setup with hosted, local-files, and self-hosted install modes.

## 0.51.7

### Patch Changes

- 499f728: Add durable provider corpus jobs for resumable paginated and batched provider searches.
- 499f728: PR Visual Recap workflow reliability + clarity:
  - Narrow the self-modifying-code skip guard so it only false-skips legitimate
    recaps: it still fires for fork PRs and for all public-repo PRs (where an
    author could rewrite loaded `AGENTS.md`/`CLAUDE.md`/`.claude`/`.mcp.json` to
    exfiltrate the secret-backed agent run), but is skipped for private-repo
    same-repo PRs whose authors are trusted org members.
  - Surface the skip reason via `core.notice` so it appears as a run-summary
    annotation, not just a buried log line.
  - Retry the agent once when it exits without writing `recap-source.json` (a
    transient miss that previously failed the whole recap with an ENOENT).
  - Upload the agent transcript (`claude-result.json`/`codex-events.jsonl` + stderr)
    alongside `recap-source.json` on failure, so a recap that fails because the
    agent produced no/invalid output is debuggable instead of a black box.

## 0.51.6

### Patch Changes

- ba3b10b: Add the `providerSearchAll` run-code helper and refresh Content template marketing around open-source Obsidian for MDX positioning.
- ba3b10b: Block background agent-team delegation for provider/source sweeps after a read-only source/search tool has exhausted its convergence budget.

## 0.51.5

### Patch Changes

- 404f9d2: Block background agent-team delegation for provider/source sweeps after a read-only source/search tool has exhausted its convergence budget.

## 0.51.4

### Patch Changes

- 8b559ca: Tell agents not to bypass exhausted source-sweep budgets by delegating the same one-at-a-time provider fan-out to background agents or follow-up threads.

## 0.51.3

### Patch Changes

- 789b9ca: Clarify visual-plan ownership guidance so agents keep using structured Plans while choosing hosted, local-files, or self-hosted mode based on privacy and brand-control needs.
- 789b9ca: Tell agents to switch to bulk/code/provider API workflows when repeated source sweeps hit the convergence budget, instead of asking users to approve the obvious next read-only step.

## 0.51.2

### Patch Changes

- 3f2e709: Count source/search tool sweeps across internal agent continuations so hosted runs converge instead of resetting the sweep budget after serverless soft timeouts.

## 0.51.1

### Patch Changes

- 1c752f4: Stop repeated read-only source sweeps from looping indefinitely by forcing a final coverage summary after the same provider/search tool is called many times in one turn.

## 0.51.0

### Minor Changes

- 6896529: Add an AgentHarness substrate for running full agent runtimes through Agent
  Native, including durable harness session storage, AI SDK harness adapter
  support, run-manager integration, and background-run projection.
- 6896529: Add a shared provider API quota governor with request dedupe, Retry-After handling, and cooldown persistence.

### Patch Changes

- 6896529: Remove decorative box shadows from visual plan and recap wireframe frames.
- 6896529: Make the PR Visual Recap workflow easier to debug and safer against deploy
  gaps: upload the agent-authored `recap-source.json` as a CI artifact when the
  publish fails (previously only the screenshot was kept, so failures were
  opaque), and add a pre-publish route-health probe that fails with a clear
  "plan app routes return 404 - deploy not yet propagated" diagnostic instead of
  letting the agent run and fail confusingly when the plan server is behind.
- 6896529: Back workspace file helpers with the existing Resources table and keep the
  legacy workspace-files bridge hidden from normal agent tool lists.

## 0.50.0

### Minor Changes

- 29349c5: Add an AgentHarness substrate for running full agent runtimes through Agent
  Native, including durable harness session storage, AI SDK harness adapter
  support, run-manager integration, and background-run projection.
- 29349c5: Add a shared provider API quota governor with request dedupe, Retry-After handling, and cooldown persistence.

### Patch Changes

- 29349c5: Remove decorative box shadows from visual plan and recap wireframe frames.
- 29349c5: Make the PR Visual Recap workflow easier to debug and safer against deploy
  gaps: upload the agent-authored `recap-source.json` as a CI artifact when the
  publish fails (previously only the screenshot was kept, so failures were
  opaque), and add a pre-publish route-health probe that fails with a clear
  "plan app routes return 404 - deploy not yet propagated" diagnostic instead of
  letting the agent run and fail confusingly when the plan server is behind.
- 29349c5: Back workspace file helpers with the existing Resources table and keep the
  legacy workspace-files bridge hidden from normal agent tool lists.

## 0.49.27

### Patch Changes

- 1d466d6: Builder file upload provider now routes files over 30 MB through a signed-URL flow (request URL → direct storage PUT → register asset), so large uploads no longer hit the ~32 MB request cap. Smaller files keep the existing direct-POST path with retries.

## 0.49.26

### Patch Changes

- e63c360: Add durable hosted MCP ask_app tasks with ask_app_status polling.
- 8726f38: Teach all app agents that provider shortcut actions are not capability limits and that broad provider searches, joins, classifications, and absence claims should use provider API staging, saved responses, staged-dataset queries, or sandboxed code with explicit coverage reporting. Ensure lean, A2A, and MCP ask-agent registries include run-code when code execution is enabled, and give sandboxed code generic providerRequest/providerFetchAll helpers for broad paginated provider corpus work.
- e63c360: Support provider API pagination cursors sent through JSON request bodies.
- e63c360: Make PR visual recap robust to plan-app deploy-propagation windows. The recap
  CLI ships to npm independently of the plan-app server, so a recap can run after
  the new CLI is live but before the matching action routes have propagated to
  every cold-start server instance:
  - `create-visual-recap` publish now retries a transient 404 (the route 404s on a
    not-yet-updated instance) instead of failing the recap outright.
  - The live block-reference fetch (`get-plan-blocks`) now retries transient
    404s/timeouts before falling back to bundled instructions, so the agent
    authors against the current block vocabulary instead of stale tags.

- e63c360: Anchor overlapping code annotation hover cards to the right edge.

## 0.49.25

### Patch Changes

- a984507: Broaden provider API integration access and preserve provider base paths.

## 0.49.24

### Patch Changes

- 56ad6cf: Preserve agent chat request modes across bridges.

## 0.49.23

### Patch Changes

- dc1e7a0: Serve compact MCP tool catalogs by default and require explicit full-catalog opt-in.
- dc1e7a0: Improve agent-native analytics substrate: general provider staging detects single
  array payloads, code execution can call agent-exposed read-only actions, and
  providerFetch preserves structured request options.
- dc1e7a0: Harden PR visual recap screenshots by installing browsers from the recap CLI's Playwright package, retrying oversized screenshots at CSS scale, surfacing screenshot/upload diagnostics, and restoring fork workflow MCP smoke-test parity.
- dc1e7a0: Make MCP reconnect more resilient when OAuth metadata discovery is temporarily
  unavailable by retrying discovery and falling back to bearer-token reconnect for
  existing connectors.
- dc1e7a0: Soften recap code annotation cards and limit screenshot capture mode to one expanded annotation per block.
- dc1e7a0: Make PR visual recaps publish from an agent-authored source file through the
  deterministic CLI, avoiding flaky MCP tool discovery inside CI agent runtimes.

## 0.49.22

### Patch Changes

- 909a419: Reduce PR visual recap secret-scan false positives and surface gate skip reasons reliably.
- 909a419: Expose local file mode AGENTS.md, skills, agent-native.json, and MCP config files through workspace resources.
- 909a419: Improve plan annotation overlay backgrounds so annotated code and diff callouts stay legible over code.
- 909a419: Match the question-form footer background to the plan document surface.
- 909a419: Hide the dev database admin footer link from app sidebars.
- 909a419: Polish PR visual recap comments, diagram framing, and screenshot annotation placement.
- 909a419: Run the PR visual recap on fork pull requests when the publish token is
  available. The gate now keys off secret availability instead of blanket-skipping
  all forks, so private orgs that send secrets to fork PRs get recaps on forks; the
  prompt gets the fork prompt-injection note via the new `--fork-pr` wiring, and
  forks without secret access get an actionable skip message.
- 909a419: Bound each PR visual recap MCP smoke probe with a per-attempt abort timeout so a
  cold-start hang on the plan app fails fast and the workflow's retry loop can
  re-probe a warm endpoint instead of blocking on undici's multi-minute default.
- 909a419: Allow PR visual recaps to run on visual-plan and visual-recap skill file changes
  when CI uses the default bundled recap instructions.

## 0.49.21

### Patch Changes

- f0df64f: Reduce PR visual recap secret-scan false positives and surface gate skip reasons reliably.
- f0df64f: Expose local file mode AGENTS.md, skills, agent-native.json, and MCP config files through workspace resources.
- f0df64f: Improve plan annotation overlay backgrounds so annotated code and diff callouts stay legible over code.
- f0df64f: Match the question-form footer background to the plan document surface.
- f0df64f: Hide the dev database admin footer link from app sidebars.
- f0df64f: Polish PR visual recap comments, diagram framing, and screenshot annotation placement.
- f0df64f: Run the PR visual recap on fork pull requests when the publish token is
  available. The gate now keys off secret availability instead of blanket-skipping
  all forks, so private orgs that send secrets to fork PRs get recaps on forks; the
  prompt gets the fork prompt-injection note via the new `--fork-pr` wiring, and
  forks without secret access get an actionable skip message.
- f0df64f: Bound each PR visual recap MCP smoke probe with a per-attempt abort timeout so a
  cold-start hang on the plan app fails fast and the workflow's retry loop can
  re-probe a warm endpoint instead of blocking on undici's multi-minute default.
- f0df64f: Allow PR visual recaps to run on visual-plan and visual-recap skill file changes
  when CI uses the default bundled recap instructions.

## 0.49.20

### Patch Changes

- b4e6e91: Expose local file mode AGENTS.md, skills, agent-native.json, and MCP config files through workspace resources.
- b4e6e91: Improve plan annotation overlay backgrounds so annotated code and diff callouts stay legible over code.
- b4e6e91: Allow PR visual recaps to run on visual-plan and visual-recap skill file changes
  when CI uses the default bundled recap instructions.

## 0.49.19

### Patch Changes

- 743589e: Allow PR visual recaps to run on visual-plan and visual-recap skill file changes
  when CI uses the default bundled recap instructions.

## 0.49.18

### Patch Changes

- 4d0fb20: Add allowlisted wireframe icon markers for visual plans/recaps and trim private plan sign-in copy.

## 0.49.17

### Patch Changes

- 271e70c: Improve the skills installer UI and managed instruction handling: show Clack
  progress/receipt output, keep user-scoped managed instructions in user config
  files, shorten managed instruction blocks to skill pointers, and forward
  `--no-connect` through delegated installs.
- 271e70c: Add Builder-managed web search as a fallback for the agent web-search tool.
- 271e70c: Allow HTTP action routes to opt out of required auth for safe metadata reads.
- 271e70c: Render the visual recap PR comment intro as standard text and clarify that
  private-repo recap links may require signing in with org access.

  Register the Plan MCP under both `plan` and `agent-native-plans` in recap CI so
  Claude can publish through either exposed tool namespace.

- 271e70c: Avoid Sentry HTTP instrumentation in the CLI so visual recap MCP smoke checks
  reach hosted Plan MCP routes reliably.

## 0.49.16

### Patch Changes

- f101c6f: Avoid Sentry HTTP instrumentation in the CLI so visual recap MCP smoke checks
  reach hosted Plan MCP routes reliably.

## 0.49.15

### Patch Changes

- 72a8b20: Render the visual recap PR comment intro as standard text and clarify that
  private-repo recap links may require signing in with org access.

  Register the Plan MCP under both `plan` and `agent-native-plans` in recap CI so
  Claude can publish through either exposed tool namespace.

## 0.49.14

### Patch Changes

- ecbdbf8: Document local component workspace support for Content local file mode.

## 0.49.13

### Patch Changes

- 13be342: Bury the share menu's organization search visibility toggle under Advanced.
- 13be342: Add a PR Visual Recap Plan MCP smoke test so CI catches missing publishing tools before running the recap agent.
- 13be342: Add repo-backed local file extensions for Local File Mode workspaces.
- 13be342: Give the sticky question-form submit footer an opaque background so plan content does not show through while scrolling.
- 13be342: Make share link copy buttons use the shared clipboard fallback path.

## 0.49.12

### Patch Changes

- 32672b7: Fix Vite dev SSR for npm-installed standalone apps by aliasing react-router to the app's install so SSR and the dev router share one React Router context.

## 0.49.11

### Patch Changes

- c5abc5c: Keep generated app SSR entries on their app-local React Router singleton by
  passing the local `ServerRouter` into the shared document request handler.
- c5abc5c: Render default social OG images with branded first-party app names.
- c5abc5c: Fix extension secret setup guidance and hosted Dispatch template scaffolding.
- c5abc5c: Add server-side local artifact helpers for manifest-driven local file mode.
- c5abc5c: Version default Agent-Native social image URLs so social crawlers pick up the fixed rendered preview instead of stale cached images.

## 0.49.10

### Patch Changes

- ee66e0a: Serialize local auto dev account creation so concurrent first-page requests do not race into duplicate Better Auth user inserts.
- ee66e0a: Declare the Floating UI DOM runtime dependency required by TipTap floating menu support.
- ee66e0a: Capture PR Visual Recap screenshots in GitHub-matched light and dark modes and embed them with a theme-aware picture element.
- ee66e0a: Ensure PR visual recap agents request the full Plan MCP catalog and refresh stale Codex MCP config before publishing recaps.
- ee66e0a: Fix PR visual recap comments and hosted recap links so failed runs no longer advertise stale private recap URLs, and public `/recaps/:id` links resolve for signed-out viewers.

## 0.49.9

### Patch Changes

- 18741fe: Improve reconnect success output with a clear final status, avoid URL-only Codex config for hosted authenticated MCPs, and keep noninteractive skills installs from downgrading existing bearer-token MCP entries.
- 18741fe: Keep React Router in the dev SSR module graph so standalone starter dev smoke uses one router context.
- 18741fe: Run PR visual recaps from trusted base or published CLI code while allowing normal core package changes to receive recap coverage.

## 0.49.8

### Patch Changes

- 0cd1a64: Route missing LLM credentials through the agent chat run-error card while preserving the legacy `missing_api_key` SSE stream type.

## 0.49.7

### Patch Changes

- 80393d3: Improve visual plan code annotation placement with left-first plan hovers and persistent margin notes when space allows.

## 0.49.6

### Patch Changes

- a784d3c: Default app-backed skill setup to all supported clients, clarify Plan MCP auth as per-client, and make reconnect output name which local agent configs were actually refreshed.
- a784d3c: Keep React Router as a consumer peer instead of a core runtime dependency so scaffolded apps use a single router instance for SSR framework context.
- a784d3c: Update user-facing `npx` guidance to recommend explicit `@latest` package invocations.

## 0.49.5

### Patch Changes

- 809e96b: Fix Vite dev SSR for standalone apps using `file:@agent-native/core` by aliasing monorepo core source and deduping `react-router`. Add a Playwright dev smoke test that catches HydratedRouter/Meta render failures after auto-login.

## 0.49.4

### Patch Changes

- 25454af: Improve extension direct-link loading by retrying transient detail misses, avoiding false not-found flashes, and slimming extension list responses.
- 25454af: Clarify file upload provider guidance so connected Builder.io is presented as
  the primary upload setup path.

## 0.49.3

### Patch Changes

- b7b105a: Canonicalize hosted Plans MCP connections to the `plan` server name and let the Plan template advertise that name from the connect flow.
- b7b105a: Make `reconnect <url>` reauthenticate existing MCP entries instead of acting like first-time setup when duplicate server names point at the same URL.
- b7b105a: Guard Builder gateway runs from stale or unsupported model IDs by normalizing
  server-side model selection and tightening Builder model saves.
- b7b105a: Render visual recap screenshot annotation overlays through a portal and capture
  recap screenshots at 2x device scale.
- b7b105a: Surface PR visual recap failure diagnostics from missing recap URLs, agent stderr,
  exit codes, stale workflow result files, and reusable caller permission issues.

## 0.49.2

### Patch Changes

- b57b183: Prevent stale interrupted agent tool calls from appearing as live running tools after chat stream recovery.

## 0.49.1

### Patch Changes

- dfa79d9: Document deployment code-execution settings and local file sync surfaces.

## 0.49.0

### Minor Changes

- d77a37f: Long-lived MCP OAuth tokens and lightweight reconnect command.
  - Access tokens are now long-lived (30-day default, env-overridable) with a
    sliding 365-day refresh window, so random 401s after one hour are eliminated.
  - Audience and signing-secret verification tolerances have been tightened to
    prevent spurious auth failures on host-drift or MCP URL variations.
  - `reconnect` command now detects any agent-native MCP config entry whose URL
    ends in `/_agent-native/mcp` for the given host, matching by URL regardless
    of connector name — no more breakage when the entry is named `plan` vs
    `agent-native-plans`.
  - Installs no longer write duplicate alias entries and clean up existing
    duplicates on the next connect or skills-add run.
  - All CLI, server, skill, and docs guidance now uses `npx @agent-native/core@latest reconnect <app-url>`
    as the documented one-line reauth path and consistently teaches that
    reinstalling from scratch is never needed to fix auth.

- d77a37f: Add best-effort install-funnel analytics to both skills CLIs (`npx @agent-native/skills@latest` and `npx @agent-native/core@latest skills`). Each run reports a step-by-step funnel — started, skills prompted, skills selected, clients selected, scope selected, install completed, MCP registered, connect, and completed/failed/cancelled — to the first-party Agent Native Analytics endpoint, so install volume, skill selection, and step-by-step dropoff can be measured. Events carry a stable per-machine install id (unique installs) and a per-run id (dropoff) and never include paths, repo names, or other identifying data. Telemetry is fire-and-forget, flushes before exit, and is opt-out via `DO_NOT_TRACK=1` or `AGENT_NATIVE_TELEMETRY_DISABLED=1`.
- d77a37f: Unify the two skills installers onto one codebase + UX.
  - `npx @agent-native/skills@latest add` / `list` now delegate to `@agent-native/core`'s
    clack-based installer (`runSkills`, newly exported at `@agent-native/core/cli/skills`),
    so the standalone CLI and `agent-native skills` share the exact same interactive
    experience, MCP-server registration, and authentication. A `AGENT_NATIVE_SKILLS_DIRECT`
    env guard keeps core's plain-repo delegation from looping back.
  - `agent-native skills add`: the optional PR Visual Recap GitHub Action is now offered
    **before** any install/registration, with copy that explains it's a GitHub Action and
    what it does. The final summary is rendered with clack (a boxed note + a "✅ All set!"
    outro that points you at the new slash command and a reload).

### Patch Changes

- d77a37f: Surface sanitized agent output when PR visual recap generation does not produce a plan URL.
- d77a37f: Clean up PR visual recap screenshots and comments by removing the GitHub `As of` line, capturing recap screenshots at 950px/100% zoom, and hiding viewer chrome plus changed-file sections in screenshot mode.

## 0.48.4

### Patch Changes

- 7ee8be6: Always hard-CDN-cache SSR for every visitor; make the login page an
  env-independent cacheable shell.

  The SSR handler was downgrading every authenticated request (any request
  carrying a session cookie) to `private, no-store`, so logged-in visitors got
  zero CDN caching on every page — including fully public pages like the docs
  site. SSR responses are now served with the standard public
  short-fresh / long-stale-while-revalidate policy for ALL visitors,
  authenticated or not. To make that safe, the SSR handler no longer reads the
  request session/cookies: it renders an impersonal public shell, and all
  per-user state (who is signed in, private records, share-grant access) is
  resolved client-side after load. A strong guardrail comment now documents that
  SSR must never vary by cookie/session and must never be marked private/no-store.

  Relatedly, the login page (the public homepage of every app) is now
  env-independent: a Google-only app always renders a working Google sign-in
  button instead of baking a render-time "Google sign-in is not configured"
  message into the CDN-cached HTML. A genuinely misconfigured server surfaces the
  error at click time via the auth API instead.

- 7ee8be6: Add a reusable `RequireSession` client gate that redirects unauthenticated
  visitors to the framework sign-in page instead of leaving a protected app shell
  stuck on an infinite loading spinner. The server-side auth guard only protects
  requests that reach the Nitro function; a statically-served/cached SPA shell or
  a client-side navigation after the session expired never re-hits it, so the app
  boots with no session and every data query 401s into a permanent loading state.
  Wrap a private app shell with `<RequireSession>` (with optional `bypass` for
  embed/popout surfaces that authenticate by another mechanism) to close that gap.
- 7ee8be6: Service token mint auto-resolves org from membership when bearer token has no org context
- 7ee8be6: Keep the agent sidebar's running indicator showing a steady "Thinking" while the
  model works, instead of flipping through transient framework step labels (e.g.
  "Contacting model", "Preparing X action") right after a message is submitted.
  The Reconnecting and Resuming connection states are unchanged.
- 7ee8be6: Skills installer: offer the two plan skills independently, prompt for scope, and
  install built-in instructions in-process.

  The interactive `agent-native skills` installer now offers exactly `visual-plan`
  and `visual-recap` as two separate, independently selectable entries (both
  checked by default) instead of a single bundled "Agent-Native Plan" row.
  Selecting both still registers the shared hosted plan MCP connector once;
  selecting only one installs just that skill. `agent-native skills add
visual-plan` / `visual-recap` likewise install only the named skill, while the
  bundle aliases (`visual-plans`, `plannotate`, …) still install both. The PR
  Visual Recap GitHub Action offer is now gated on `visual-recap` being part of
  the install.

  The installer also prompts for install scope (Project vs User) when `--scope`
  is not passed, matching the open `skills` CLI UX.

  Built-in skill instructions are now written straight into each client's skills
  directory instead of shelling out to `npx @agent-native/skills@latest` — that
  package is not published yet, so the previous delegation failed with a 404
  mid-install. External/plain skill repos still use the standalone installer.

- 7ee8be6: Recover from stale lazy-chunk failures on the current route. After a deploy,
  an old tab whose hashed chunk filenames no longer exist would strand the user
  on a broken view (and report `Failed to fetch dynamically imported module` to
  Sentry) whenever the failure was not tied to a fresh cross-route navigation.
  The route chunk recovery now performs a single, loop-guarded reload of the
  current page (via sessionStorage cooldown) for both unhandled dynamic-import
  rejections and `React.lazy` failures caught by the framework `ErrorBoundary`,
  fetching fresh assets instead of failing. Desktop webviews are left untouched,
  matching existing behavior.

## 0.48.3

### Patch Changes

- aa337a0: Add a reusable `RequireSession` client gate that redirects unauthenticated
  visitors to the framework sign-in page instead of leaving a protected app shell
  stuck on an infinite loading spinner. The server-side auth guard only protects
  requests that reach the Nitro function; a statically-served/cached SPA shell or
  a client-side navigation after the session expired never re-hits it, so the app
  boots with no session and every data query 401s into a permanent loading state.
  Wrap a private app shell with `<RequireSession>` (with optional `bypass` for
  embed/popout surfaces that authenticate by another mechanism) to close that gap.
- aa337a0: Service token mint auto-resolves org from membership when bearer token has no org context

## 0.48.2

### Patch Changes

- 16f934d: Restore the legacy `/_agent-native/poll-events` SSE route alongside the current `/_agent-native/events` route so collaboration clients and cached bundles keep receiving live updates.

## 0.48.1

### Patch Changes

- 60355cc: Fix recharts/es-toolkit default export error in dev

## 0.48.0

### Minor Changes

- 3c1d3eb: Resurrect end-to-end action type inference.

  `defineAction` overloads now return a typed `ActionDefinition<TInput, TReturn>` instead of `any`. The schema-inferred input type (via `StandardSchemaV1.InferOutput<TSchema>`) and the run callback's return type flow through to `useActionQuery`, `useActionMutation`, and `callAction` once the generated `.generated/action-types.d.ts` is included in the project's TypeScript config.
  - Added `ActionDefinition<TInput, TReturn>` interface (exported from `@agent-native/core`).
  - All 15 template `tsconfig.json` files now include `.generated/**/*` so the generated registry d.ts is picked up automatically.
  - Scaffold default tsconfig updated to match.
  - Exports `ActionDefinition` from the core package index.

- 3c1d3eb: Add a server-only `completeText()` helper for narrow one-shot text transforms through the framework engine layer, export custom chat adapter/surface types, and document background agent sends plus custom chat UI escape hatches.
- 3c1d3eb: Agent Teams completion loop, stop affordances, and orphan sweep
  - **Completion loop (P0)**: `finalizeAgentTeamRun` now appends a durable `parent-completion` injection to the parent thread's app-state queue and writes a NotificationsBell entry. The orchestrator chat's `prepareRequest` drains these injections and prepends them to the next user message so sub-agent results surface automatically without manual polling.
  - **Sub-agent tab read-only (P1)**: Sub-agent tabs in `MultiTabAssistantChat` now disable the composer (`composerDisabled`) with a descriptive placeholder. Sending from a sub-agent tab would start a new run on that thread and kill the in-flight team chunk; the disabled composer prevents this without touching `AssistantChat.tsx`.
  - **Stop affordances (P1)**: Added `POST /runs/:id/stop` route in agent-chat-plugin that delegates to `stopAgentTeamBackgroundRun`. `RunsTray` now shows a stop button (Tabler `IconPlayerStop`) for running agent-team rows. `AgentTaskCard` shows a Stop button in its footer while the task is running. Both use optimistic UI.
  - **Orphan sweep (P2)**: A server-side sweep runs every 2 minutes (via a 30s check interval + 2-min throttle) to reconcile all owners with active queue rows. Re-fires stuck/queued dispatches when the browser is closed and no RunsTray poll triggers.

- 3c1d3eb: Add edit, regenerate, and branch picker affordances to the chat UI.
  - **Edit user messages**: hover the pencil icon on any user message (when not running) to enter inline edit mode; the bubble swaps to a textarea composer with Cancel/Save buttons. Sending an edited message creates a new branch via assistant-ui's edit composer semantics. Edit is disabled while a run is active to avoid race conditions with the abort+wait path.
  - **Regenerate last assistant message**: a refresh icon appears on the last assistant message's action bar on hover, using `ActionBarPrimitive.Reload`. Disabled automatically while the thread is running. Regenerate creates a client-side branch from the parent user message and sends the prior history to the server as a fresh run; the server appends the new response as a new `thread_data` entry (consistent with the append-only fold — no duplicate or conflict).
  - **Branch picker**: when a message has multiple branches (after edits or regenerations), `BranchPickerPrimitive` shows ‹ 1/2 › navigation on that message, styled to match the existing ghost action-bar buttons. Shown on both user and assistant messages.

- 3c1d3eb: Code tab improvements: always-allow and deny buttons in the approval callout (model auto-resumes after both); persist command allowlist per-machine so approved commands skip future approvals; emit thinking-delta events from the agent loop as collapsible transcript cells; surface cumulative input/output token counts and approximate context-window usage per run; Electron notifications for run-completed, run-failed, and approval-needed when the window is unfocused (with dock badge on macOS); byte-offset transcript tailing in the main process so only appended JSONL bytes are read on each file-watch event instead of re-reading the whole file.
- 3c1d3eb: Add structured tool cells for the Code tab: bash terminal view with exit code / duration badges, edit diff viewer (computed client-side from old/new text), write cell with new-file styling, and an end-of-turn files-changed summary. Raise the bash output retention window to first 4 KB + last 16 KB. Emit structured metadata (command, cwd, exitCode, durationMs, oldText/newText, lineCount) from the coding-tools executor as a side-channel so the UI can render bespoke cells without breaking the string-result contract the agent sees.
- 3c1d3eb: Add connector-catalog tier for hosted multi-tenant MCP deployments.

  When `AGENT_NATIVE_CONNECTOR_CATALOG=1` is set and a template declares a `connectorCatalog` in `createAgentChatPlugin` options, external MCP clients see only the declared action allow-list plus the four builtin cross-app tools (`list_apps`, `open_app`, `ask_app`, `create_embed_session`). Calls to tools outside the list are rejected. Individual callers can opt up to the full surface by minting their token with `agent-native connect --full-catalog`, which embeds a `catalog_scope: "full"` claim in the JWT. Local and dev deployments without the env flag are unaffected. The plan template declares its curated connector catalog covering plan CRUD, sharing, upload, navigation, automations, and tool-search while excluding db-exec, seed-\*, extension tools, browser-session tools, and context-xray internals.

- 3c1d3eb: Add per-model context window table and one-shot overflow recovery
  - `model-config.ts`: new `getContextWindowForModel(modelId)` helper and explicit
    context-window table covering all catalog models. Claude Sonnet 4.6 / Opus 4.7+
    = 1 M, Haiku 4.5 / Fable 5 = 200 K, GPT-5.4/5.5 = 1.05 M, Gemini 2.x/3.x
    = 1 M, unknown models = conservative 128 K default.
  - `client/context-xray/format.ts`: new `resolveContextWindow(modelId?)` helper
    that replaces the hard-coded 200 K constant in `ContextMeter` and
    `ContextXRayPanel` so the gauge and headroom calculation reflect the real
    window for large-context models.
  - `agent/production-agent.ts`: context-window overflow is no longer a terminal
    dead-end. On the first overflow the agent attempts one automatic recovery pass:
    old tool-result content (outside the most-recent 10-message tail) is replaced
    with a short stub and the engine call is retried once. Only if that second
    attempt also overflows does the terminal error fire — with updated copy that
    explains the recovery attempt and suggests continuing in a new chat or asking
    the agent to summarize. New exported pure helper `trimOldToolResults` is
    unit-tested independently.
  - `client/error-format.ts`: `context_length_exceeded` / `input_too_long` errors
    now append a "Start new chat" CTA link (matching the `builder_gateway_error`
    pattern) so users have a one-click escape path from the error card.

- 3c1d3eb: Extract hand-copied template shell into `@agent-native/core` as shared exports.

  New exports:
  - `@agent-native/core/server/entry-server` — exports `handleDocumentRequest` (default) and `streamTimeout`. Superset of all 6 entry.server.tsx variants in the template fleet. Removes dead `typeof wrapWithAnalytics === "function"` guards (it is a plain import, never conditionally undefined). Adds `.well-known/` 404 rejection (content template improvement, now the default for all).
  - `@agent-native/core/client` — exports `AppProviders`, a composed `QueryClientProvider → ThemeProvider → TooltipProvider → Toaster` shell. Accepts `queryClient` prop so each template keeps its own `createAgentNativeQueryClient(overrides)` call. Supports the public-path SSR branch pattern (calendar/clips/content) via `isPublicPath` + `clientOnlyFallback` props.

  `templates/starter` and `packages/core/src/templates/default` (scaffold) are migrated to one-line re-exports of the shared handler. A sync spec (`starter-shell-sync.spec.ts`) guards byte-identity between scaffold and starter so they never drift again.

- 3c1d3eb: Lazy-load the assistant-ui chat stack (~650-700 KB gzip) off the critical path of every page.
  - `AgentPanel`: `MultiTabAssistantChat` converted to `React.lazy` + `Suspense`; sidebar chrome renders immediately while the chat chunk loads.
  - `AssistantChat`: `react-markdown` + `remark-gfm` deferred via a module-level async loader (same pattern as shiki); plain-text fallback shown during the one-frame load window.
  - New `@agent-native/core/client/api-path` source alias registered in `CORE_CLIENT_SUBPATHS` and `getCoreSourceAliases` so monorepo dev resolves it from `src/`.
  - All `templates/*/app/entry.client.tsx` (and the scaffold copy) changed to `import { appBasePath } from '@agent-native/core/client/api-path'` so the full client barrel — and its transitive chat-stack imports — are no longer in the static closure of the client entry point.
  - `@agent-native/core/client/api-path` is an existing public export; `AssistantChat`, `MultiTabAssistantChat`, `ResourcesPanel`, `SettingsPanel`, and `AgentTerminal` remain re-exported from the barrel for consumers that use them directly (marked minor because the barrel lazy-routing is a behaviour change for those named re-exports).

- 3c1d3eb: Add server-side staging layer for provider-api responses.
  - **Staging primitive (P0)**: `provider-api-request` now accepts `stageAs` to write response items into a scoped scratch dataset (`staged_datasets` + `staged_dataset_rows`) instead of returning the raw body. Returns `{ dataset, rowCount, columns, sampleRows }` — keeping large payloads out of the context window and avoiding the 50 K-char truncation that silently biases aggregates.
  - **Paginated fetch-all (P1)**: Pass `pagination` alongside `stageAs` to fetch all pages server-side (cursor / page / offset modes). Handles 429 / Retry-After with exponential back-off. Caps at `maxPages` (default 50, up to 200) and returns `{ pages, rows, truncated, lastCursor }`.
  - **New actions**: `query-staged-dataset` (in-process TypeScript aggregation — groupBy, sum/avg/count/min/max, where filters, orderBy/limit), `list-staged-datasets`, `delete-staged-dataset`. Portable across Postgres and SQLite — no dialect-specific JSON SQL.
  - **Storage caps**: 200 K rows / 50 MB per app. Dataset ownership is scoped to `(app_id, owner_email)`.
  - **Analytics template**: adds the three staging actions and updates `cross-source-analysis` + `provider-api` skills to teach the stage-then-aggregate flow.

- 3c1d3eb: Expose focused public client subpaths for custom chat, composer, conversation, collaboration, rich-editor, and resources UI composition.

  Adds `@agent-native/core/client/chat`, `@agent-native/core/client/composer`, `@agent-native/core/client/conversation`, `@agent-native/core/client/collab`, `@agent-native/core/client/editor`, and `@agent-native/core/client/resources`, promotes the low-level `TiptapComposer` props/types through the composer surface, exports `dedupeCollabUsersByEmail`, and documents how to rebuild agent chat/sidebar, realtime presence, rich editor, and resources experiences from public pieces.

- 3c1d3eb: Export `createAgentNativeQueryClient` from `@agent-native/core/client` with house defaults (staleTime 30s, auth-aware retry, refetchOnWindowFocus false); raise commandRefetchInterval default from 2s to 15s.
- 3c1d3eb: Upload-first chat attachments: when a file-upload provider is configured, images and files are uploaded to hosted URLs at send time and stored as URL references in thread_data (no more base64 blobs in SQL). Added `read-attachment` core tool for paginating large text attachments that exceed the 60 K context limit. Base64 fallback path retained with a 2 MB-per-attachment cap.

### Patch Changes

- 3c1d3eb: Add the `@agent-native/skills` installer CLI for plain Codex/Claude skill repos and let `agent-native skills add` delegate public skill repositories like `BuilderIO/skills` to it.
- 3c1d3eb: Harden agent runtime resume and chat attachment edge cases.
- 3c1d3eb: Add Content-Security-Policy to app document responses: `object-src 'none'; base-uri 'self'` enforced, `script-src` emitted as Report-Only with a Sentry-config hash when configured. Skipped in dev and opt-outable via `AGENT_NATIVE_DISABLE_DOC_CSP=1`.
- 3c1d3eb: AppProviders parity polish: add `disableThemeTransitions` prop (default `true`),
  wire it through ThemeProvider `disableTransitionOnChange`; restore pre-migration
  per-template parity — calendar `position="bottom-center"`, dispatch `closeButton`,
  content animated transitions + deduped toaster, slides `defaultTheme="dark"` (drops
  outer ThemeProvider workaround), brain `tooltipDelayDuration={250}`, macros
  `defaultTheme="dark"` + `tooltipDelayDuration={300}`; migrate plan root to
  AppProviders; reconcile scaffold/starter `entry.client.tsx` and enable byte-identity
  guard.
- 3c1d3eb: Extend `AppProviders` with customisation props needed for dark-first and theme-customised templates.

  New props on `AppProvidersProps`:
  - `defaultTheme` — passed to next-themes `ThemeProvider`. Defaults to `"system"`. Dark-first templates (videos, slides, macros, analytics) pass `"dark"`.
  - `themeAttribute` — passed to next-themes `ThemeProvider.attribute`. Defaults to `"class"`. Use `["class", "data-theme"]` when CSS variables are keyed off a data-theme attribute.
  - `tooltipDelayDuration` — passed to Radix `TooltipProvider.delayDuration` (ms).
  - `toaster` — custom Toaster element. Pass `null` to suppress the built-in Toaster when children include a styled one.

- 3c1d3eb: Decompose AssistantChat.tsx into cohesive chat/ sub-modules (behavior-identical extraction). AssistantChat.tsx reduced from ~6,600 to ~3,200 lines with all public exports preserved via re-exports.
- 3c1d3eb: Fix agent chat intermittently scrolling to the top when sending a prompt in an ongoing conversation. When the message list briefly shrank on a re-render (content swap, collapsing streaming/reconnect placeholder, message list remount), the browser-forced `scrollTop` clamp was misread as the user scrolling up, detaching auto-follow and stranding the conversation scrolled up — sometimes at the very top. The near-bottom autoscroll handler now ignores downward scroll jumps caused by content shrinking, so it stays anchored to the bottom; genuine user scroll-ups still detach.
- 3c1d3eb: Reject SVG and non-raster MIME types on avatar write to prevent stored-XSS via data:image/svg+xml payloads.
- 3c1d3eb: Consolidate 7 private copies of normalizeAppBasePath/getAppBasePath onto the canonical exported module in `server/app-base-path.ts`. Adds `getAppBasePathFromViteEnv` for SSR builds that need `import.meta.env` fallback, and `stripAppBasePath` as a shared helper. Template-literal copies inside the generated Cloudflare worker entry in `deploy/build.ts` are intentionally left in place as they cannot import at runtime.
- 3c1d3eb: Fix db.transaction(async …) throwing on the default local-SQLite (better-sqlite3) database by replacing the sync-only native wrapper with a manual BEGIN IMMEDIATE / COMMIT / ROLLBACK path; nested async calls use SAVEPOINTs.
- 3c1d3eb: Prune orphaned \*.spec.js / \*.spec.d.ts files from dist in finalize-build.mjs; add incremental tsc across all tsc-built packages to speed up repeated builds.
- 3c1d3eb: Raise coding agent maxIterations from 12 to the shared DEFAULT_AGENT_MAX_ITERATIONS (100) and inject AGENTS.md/CLAUDE.md + .agents/skills index into the system prompt so the coding agent respects repo instructions and knows what skills are available.
- 3c1d3eb: code-agent-executor: structured multi-turn history and bash improvements

  Replace the flat transcript-blob approach in `buildCodeAgentMessages` with proper `EngineMessage[]` reconstruction. The most-recent 40 transcript events are rebuilt as native user/assistant/tool-call/tool-result message pairs; older events are folded into a compact summarised preamble. This gives the model the same structured conversation replay that the sidebar uses, preserving tool-call ↔ tool-result pairing across follow-up turns and resumes.

  Also raises the bash default timeout from 30 s to 120 s, and adds a `background: true` parameter to the bash tool that spawns the command detached, returning the PID and a log-file path immediately.

- 3c1d3eb: Add --full-catalog flag to agent-native connect, matching the documented behavior.
- 3c1d3eb: Add a framework-level `core-send-email` agent tool (registered in every template when RESEND_API_KEY or SENDGRID_API_KEY is set) that sends markdown-body emails via the core transport. The tool description enforces a draft-first safety rule so the agent always shows the email to the user before sending. Keyed `core-send-email` to avoid colliding with the mail template's richer `send-email` action.
- 3c1d3eb: Dependency health fixes on the auth/runtime critical path:
  - Bump `better-auth` from exact `1.6.0` to `1.6.16` (16 patches behind)
  - Add root pnpm override pinning `kysely` to `^0.28.9` to prevent `0.29.x` pulling in breaking `DEFAULT_MIGRATION_TABLE` removal that breaks Vite builds while tsc stays green
  - Add `"sideEffects": ["*.css"]` to enable tree-shaking; client barrel is excluded (has module-level `installRouteChunkRecovery` and `stripAuthRedirectParamFromUrl` side effects)
  - Remove `@tabler/icons-react` from `dependencies` — already declared as optional peer; every template depends on it directly
  - Align `recharts` from exact pin `3.8.1` to range `^3.8.1` matching templates
  - Bump `nitro` nightly from `3.0.260415-beta` to `3.0.260603-beta`
  - Bump `vite` catalog pin from `8.0.3` to `8.0.16`

- 3c1d3eb: Comprehensive docs refresh: fix documented-but-nonexistent APIs (AUTH_DISABLED, notify/list-notifications, delegate-to-agent tool, scheduler endpoint), correct flagship examples to kebab-case actions and real Drizzle calls, consolidate the workspace docs cluster, split MCP Apps authoring into its own page, refresh template docs against current schemas, and standardize the template page skeleton.
- 3c1d3eb: Wrap Drizzle's Neon pool with the same withDbTimeout + retryOnConnectionError resilience as the raw DbExec path, preventing frozen-WebSocket 500s on template actions.
- 3c1d3eb: Fix agent-teams reliability: untruncated sub-agent results (50k char cap), proper engine resolution via resolveEngine in \_process-run, progress-aware continuation budget with no-progress detection, sub-agent token accounting with labeled usage recording, and double-claim fencing via attempts counter on heartbeat/bump/finalize writes.
- 3c1d3eb: Harden attachment handling across the chat surface:
  - **HEIC/TIFF/AVIF images**: always transcode non-web-safe image formats (HEIC, TIFF, AVIF, BMP, etc.) to JPEG/PNG via canvas before attaching; throw a visible composer error if transcoding fails instead of silently attaching raw bytes. Server-side, inject a text placeholder for any unsupported image that bypasses the client so the model knows the image was present.
  - **Base64 images in prompt text**: stop inlining image data-URLs into the text prompt string (≈700K tokens per MB); CLI code-agent now passes images as proper engine `image` content parts. PromptComposer no longer inlines images into prompt text.
  - **PDF and body-size caps**: cap PDFs at 4 MB with a clear composer error; estimate the total serialized attachment body and aggressively re-compress images if over 3.5 MB, rejecting the largest attachment with a clear error if still over.
  - **Server-side upload limits**: `/file-upload` and `/resources/upload` now enforce a 25 MB file size cap (413) and reject executable/script MIME types (415). New `readBodyWithSizeLimit`, `isAllowedUploadMimeType`, and related constants exported from `@agent-native/core/server`.
  - **Silent failure UX**: drag-drop and paste attachment errors are now surfaced as a dismissible inline error banner above the composer instead of silently logging to the console.

- 3c1d3eb: Fix four chat streaming UX issues: (1) P0 race where plain Enter while a run was active caused the new message to never be sent (appended to assistant-ui while the server run was still alive, resulting in a 409 → reconnect to old run under the new prompt); now aborts the active run first and waits for it to clear before appending. (2) P2 tool results for parallel same-name tool calls could get swapped; now matches by server-assigned id when present, with name-matching fallback. (3) P2 resuming affordance: show "Resuming…" in the thinking indicator during the 250 ms continuation window between serverless chunks, and show the last live activity label instead of bare "Thinking". (4) P1 backgrounded-tab catch-up lag: when the tab returns from background with a large streaming backlog (> 2000 graphemes), jump the reveal cursor to near the tail so only the last ~200 graphemes animate in rather than replaying minutes of content.
- 3c1d3eb: Engine and model-catalog robustness fixes: Gemini 3.x now uses `thinkingLevel` instead of the rejected `thinkingBudget`; structured provider errors (statusCode, providerRetryable) flow through EngineError so retry logic avoids false-negative and false-positive matches; isRetryableError covers OpenAI "Rate limit reached", Google RESOURCE_EXHAUSTED/quota, and bare 429/500/502/503/529 status codes; isContextTooLongError covers Gemini "input token count exceeds" phrasing; model catalog adds claude-fable-5, claude-opus-4-8, removes decommissioned Groq (llama-3.1-70b-versatile, mixtral-8x7b-32768) and stale cohere alias; supportsClaudeXHigh is version-aware for future opus successors; builder-engine enables prompt caching with system+tools+final-message cache_control breakpoints; OpenRouter default output tokens raised from 1024 to 8192; global token clamp raised from 32768 to 64000; usage pricing table adds fable-5, opus-4-8, Gemini 3, Groq, Mistral entries.
- 3c1d3eb: Fix four run-loop reliability bugs: widen RUN_STALE_MS to 15s to reduce false-positive stale reaps; self-abort displaced zombie runs and guard final status writes with a conditional WHERE so they cannot clobber a newer run's state; add per-run event persistence chaining so out-of-order SQL commits no longer silently gap the reconnect cursor; atomically gate double-run prevention with a SQL claim check instead of a racy read-then-act; emit 'clear' before resumable-error continuations to prevent duplicated partial text.
- 3c1d3eb: Add `forkPr` flag to `buildRecapPrompt` that injects a prompt-hardening security note when the diff originates from a fork PR, marking diff content as untrusted user-supplied data rather than instructions.
- 3c1d3eb: Add missing indexes on the hottest per-second poll queries: application_state (updated_at) and (key, updated_at), settings (updated_at), and org_members LOWER(email)
- 3c1d3eb: Skip direct-endpoint Neon connections on steady-state boots with no pending migrations, and close migration execs when done
- 3c1d3eb: Add org-scoped service tokens so CI credentials (e.g. the `PLAN_RECAP_TOKEN` secret used by PR Visual Recap) belong to the organization instead of one person. Previously the token was a personal device-flow bearer keyed to one owner's email — if that person left or revoked their tokens, every repo's recap CI started 401ing, and CI-created plans were owned by an individual.
  - `mcp_connect_tokens` gains additive `kind` / `service_name` / `created_by` columns; service tokens authenticate as a synthetic service principal (`svc-<name>@service.<orgId>`) whose resolved session carries the org id, so rows created by CI are org-scoped and visible to org members.
  - New core actions: `create-org-service-token` (org owner/admin, token value returned once and never stored), `list-org-service-tokens` (any org member, metadata only), and `revoke-org-service-token` (org owner/admin, same revocation gate as personal tokens).
  - New CLI flow: `agent-native connect <url> --service-token <name> [--ttl-days <1-365>]` authenticates the human via the existing device flow, mints the org service token, and prints it once with guidance to store it as the `PLAN_RECAP_TOKEN` secret.
  - Personal connect-token behavior is unchanged.

- 3c1d3eb: Enable noUnusedLocals and noUnusedParameters in core tsconfig; fix all violations.
- 3c1d3eb: Plan/recap renderer audit fixes: per-block salvage with error boundary (one bad block shows an "Unsupported block" card instead of blanking the document); annotated-code collapse for long unannotated runs; auto-TOC synthesis from block semantics when heading-derived items are sparse; file-tree rows carry data-file-path for recap files-rail scroll; export exceedsPlanBlockDepth from shared plan-content for server-side depth-exceeded detection in salvage path.
- 3c1d3eb: Visual-plan / visual-recap skill content audit fixes: visual-plan gains the same never-inline publish rule as visual-recap (stop and give the reconnect step instead of falling back to inline chat content); Core Workflow now leads with `get-plan-blocks` and the mode-matched create tool; the dead `PLAN_SETUP_AUTH_MD` constant is interpolated instead of hand-inlined; the canvas coordinate rule is stated once (surface locks footprint, board-level artboard x/y allowed for lanes); diagram-authoring guidance is deduped to a single owner in document-quality; recap gets a canonical section skeleton with numeric budgets (3-8 key-change tabs, ~150 lines per tab) and a GOOD/BAD exemplar; stale references fixed (`diffstat` block, "Wireframe Quality core below/above" pointers, implementation-maps frontmatter); the pre-share Plan-viewer render check is scoped to hosts with a browser tool; before/after columns guidance is scoped to document-body wireframes with a canvas alternative. All SKILL.md and references/\*.md copies regenerated byte-identical.
- 3c1d3eb: Gate localhost CORS fallback on NODE_ENV=development so production deployments without CORS_ALLOWED_ORIGINS no longer trust arbitrary localhost origins with credentials.
- 3c1d3eb: Modularise the system-prompt stack: extract FRAMEWORK_CORE and FRAMEWORK_CORE_COMPACT into typed builder functions under `packages/core/src/server/prompts/`, share rules 8–10 and the new rules 14–15 between both variants via a single source of truth, make provider/action examples injectable via `AgentChatPluginOptions.promptExamples`, add per-model-family overlays (GPT/Gemini), gate the 2 KB first-session personalization block to new threads only, add a "Response length" guidance section to both variants, and strengthen the `manage-progress` tool description with Codex-style plan discipline.
- 3c1d3eb: Prevent annotated code and diff hover cards from flashing during scroll dismissal.
- 3c1d3eb: Audit fixes for the PR visual-recap pipeline: emit diff byte/line size and a full-read instruction in the agent prompt so agents read the whole diff before authoring; add package-lock.json, bun.lockb, .next/, _.min.js, _.min.css, and \*.map to diff excludes; reorder diff file segments source-first before truncation so dotfile dirs (.changeset/, .github/) are sacrificed instead of src/; add a small-diff override sentence in the prompt to override the skill's skip-small-diffs advice; tighten find-plan-id extraction to require ^[A-Za-z0-9_-]{1,64}$ so injected bot-comment markers are rejected; port the auth probe step and gate skip-comment refresh (issues: write) to the reusable workflow for parity with the copy variant; fix docs to use the correct check title "Visual recap in progress", align the headline to reflect bundled-by-default skill sourcing, and complete the subcommand list.
- 3c1d3eb: Add minimal DI seams to recap.ts I/O functions for test coverage: `fetchFn?` on `githubRequest`/`findExistingComment`/`upsertComment`, `fetchFn?`/`waitFn?` on `uploadRecapImage`, and `importPlaywright?` on `runShot`. Export the four previously-private functions so the new `recap.io.spec.ts` can exercise them. No behavior change — all seams default to the original implementation.
- 3c1d3eb: Recap workflow polish: installer overwrite protection (`--force`), `RECAP_CLI_VERSION` variable pinning, auth-failure differentiation in sticky comment, screenshot size retry at scale-1 before skip, secret-scan allowlist (`.github/recap-scan-allowlist`), "pull request" copy fix, and gate-skip signal appended to existing sticky comment.
- 3c1d3eb: Add PR back-link to visual recap: `buildRecapPrompt` now deterministically threads `sourceUrl` (derived from repo + PR number) into the `create-visual-recap` tool call so the hosted recap page can link back to its source PR.
- 3c1d3eb: Add versioned reusable workflow for PR Visual Recap so consumer repos can delegate to `BuilderIO/agent-native/.github/workflows/pr-visual-recap-reusable.yml` instead of carrying a full copy. The `agent-native recap setup --reusable` flag writes a thin ~20-line caller; `buildReusableCallerWorkflow` and `writePrVisualRecapReusableCallerWorkflow` are exported for programmatic use.
- 3c1d3eb: Self-host Inter via @fontsource-variable/inter in the scaffold default template, eliminating the render-blocking Google Fonts @import from new apps
- 3c1d3eb: Replace shiki's Oniguruma WASM engine with the JavaScript regex engine in all client-side highlighters, removing ~608 KB from every template's asset bundle.
- 3c1d3eb: Collapse duplicate SSE+poll loops: extract shared SyncTransport so each tab opens one connection regardless of how many hooks subscribe.
- 3c1d3eb: SSR responses for authenticated requests are no longer publicly CDN-cacheable.
- 3c1d3eb: Eliminate duplicate org_members round trip on authenticated SSR requests: per-event memoize getOrgContext and reuse session.orgId when already backfilled.
- 3c1d3eb: Pin the Vite/Nitro dev-server runtime pair to the verified-compatible versions.
- 3c1d3eb: Cut O(n²) streaming render cost to O(tail) per commit with three targeted fixes: (1) block-memoized markdown — split streaming text into stable completed blocks + a live tail; completed blocks are wrapped in React.memo and skipped by React on every commit, only the tail re-renders; on completion a single-pass ReactMarkdown render guarantees identical final output. (2) Incremental grapheme segmentation — the Intl.Segmenter singleton is already cached at module level; now only the appended suffix is segmented per target change with a 16-char overlap to handle ZWJ/emoji cluster boundaries; falls back to full re-segmentation on non-append resets. (3) Debounced Shiki highlighting — while a code block is growing the Shiki codeToHtml call is debounced to 150 ms trailing, keeping the previous highlight visible between fires; a content-hash gate prevents redundant re-highlights on identical re-renders; a final immediate highlight fires when streaming ends. The shared HighlightedCodeBlock component is extracted to packages/core/src/client/HighlightedCodeBlock.tsx and used by both AssistantChat and AgentConversation.
- 3c1d3eb: Enable TypeScript strict mode across the framework monorepo. All template packages and core now compile with `"strict": true`, fixing implicit-any parameters, strict null checks, and function type contravariance throughout.
- 3c1d3eb: Harden agent tool dispatch with abort propagation, zombie-completion ledger, and scheduler resilience rail:
  - **Abort signal into tools**: `ActionRunContext` gains an optional `signal?: AbortSignal` field (backward-compatible). The run's abort signal is now threaded through to every `actionEntry.run()` call so well-behaved actions can cancel in-flight work instead of waiting for the 60-second hard timeout.
  - **Tool-call result ledger**: A new `agent_tool_ledger` table persists zombie completions (write-tool promises that resolve after `Promise.race` abandoned them on soft-timeout/abort). On continuation, when a write tool with the same `(threadId, toolName+inputHash)` key has a ledger entry, the continuation returns the ledger result without re-executing the side effect and without counting it toward the `MAX_WRITE_TOOL_INTERRUPTIONS` give-up budget. Ledger entries are cleared when a turn completes normally.
  - **Scheduler through the resilience rail**: Recurring jobs now route through `startRun` from run-manager instead of a bare `runAgentLoop` call. This adds a heartbeat row in `agent_runs` so a serverless kill is detected by `reapAllStaleRuns` on the next startup — no more permanently stranded `lastStatus:"running"` in job frontmatter. The soft-timeout wrapper is also applied so hosted jobs checkpoint cleanly before the function hard-kill boundary.

- 3c1d3eb: Remove dead `vite.config.server.ts` entry from tsconfig.base.json include array (the file does not exist).
- 3c1d3eb: Add a byte-identity guard spec for shared ui primitives across templates, and resync all drifted primitives to their canonical versions.

  The guard (`packages/core/src/templates/ui-primitives-sync.spec.ts`) hashes every `templates/*/app/components/ui/*.tsx` file and fails if any primitive diverges from the majority-held canonical without an explicit allow-list entry. The allow-list documents intentional deviations (custom-themed macros components, calendar DayPicker API version split, assets autoGrow textarea, etc.) so future drift is caught immediately.

  Resynced primitives include: tooltip (Portal + z-[250] + text-sm canonical), dropdown-menu (IconCircleFilled + container prop), popover (PopoverAnchor + portalled prop), dialog (hideClose prop), sheet (showClose/showOverlay props), sidebar (SheetTitle/SheetDescription accessibility), command (DialogTitle accessibility), badge, separator, scroll-area, label, form, alert-dialog, aspect-ratio, carousel, collapsible, drawer, input-otp, resizable, toggle (svg helpers + min-w), hover-card (origin transform var), navigation-menu (open state classes), radio-group and context-menu (IconCircleFilled), plus "use client" removal from forms/mail artifacts.

## 0.47.1

### Patch Changes

- 0ec6ded: Add "Interpreting comment anchors" section to the visual-plan skill and a
  matching pointer in visual-recap, teaching agents how to read coordinate
  frames, wireframe node ids, text-quote disambiguation, detached threads,
  routing via resolutionTarget, and two-axis consumed/resolved state.

## 0.47.0

### Minor Changes

- 600f83d: **Production code execution modes** (`codeExecution` plugin option + `AGENT_PROD_CODE_EXECUTION` env var)

  The agent chat plugin now accepts a `codeExecution` option to enable code-execution tools in production:
  - `"off"` (default) — no change to existing behaviour.
  - `"sandboxed"` — registers the new `run-code` tool in the production agent's tool registry.
  - `"trusted"` — registers both `run-code` and the full coding tool registry (`bash`, `read`, `edit`, `write`) in production.

  The `AGENT_PROD_CODE_EXECUTION` environment variable (`"trusted"`, `"sandboxed"`, or `"off"`) takes precedence over the plugin option, allowing per-deployment overrides without code changes.

  Dev-mode behaviour is unchanged.

  ***

  **Sandboxed `run-code` tool** (new `packages/core/src/coding-tools/run-code.ts`)

  A new `run-code` action lets the agent execute JavaScript (Node.js, ESM, top-level await) in an isolated child process:
  - Scrubbed environment: only `PATH`, `HOME`, `TMPDIR`, and similar safe POSIX vars are passed to the child. No app env vars or secrets.
  - Fresh temporary working directory per invocation.
  - Configurable timeout (default 120 s, max 600 s) and output cap (default 50 000 chars, max 200 000).
  - Ephemeral bridge HTTP server on `127.0.0.1` with a per-invocation random bearer token so the child can call allowlisted registered tools (`provider-api-request`, `provider-api-docs`, `provider-api-catalog`, `web-request`) with the parent's request context — without leaking secrets.
  - Child globals: `providerFetch(provider, path, init?)` and `webFetch(url, init?)`.
  - `run-code` is registered in dev mode unconditionally and in production when the mode is `"sandboxed"` or `"trusted"`.

  ***

  **Per-action tool limits** (`ActionEntry.timeoutMs`, `ActionEntry.maxResultChars`)

  `ActionEntry` now accepts optional `timeoutMs` and `maxResultChars` fields. When present, `runAgentLoop` uses these values instead of the global 60 s / 50 000-char defaults for that action.

  App-level defaults can be set via `toolLimits: { timeoutMs?, maxResultChars? }` on `createProductionAgentHandler` or `createAgentChatPlugin`. Per-action values take precedence.

  ***

  **`web-request` optional `maxChars` input**

  The `web-request` (fetch) tool now accepts an optional `maxChars` parameter (default 32 000, max 200 000) so the agent can request larger response bodies when needed without hitting the hard-coded 32 k truncation.

- 600f83d: **Custom provider registry** — register any API provider at runtime

  A new `custom_api_providers` SQL table (created on first use, additive) stores
  user/org-scoped provider registrations so the agent can call APIs that are not
  in the 24 built-in PROVIDER_CONFIGS:
  - `upsertCustomProvider`, `deleteCustomProvider`, `listCustomProviders`,
    `getCustomProvider` — CRUD helpers exported from `@agent-native/core/provider-api`.
  - `validateCustomBaseUrl` — SSRF-safe URL validation for registration time.
  - `createProviderApiRuntime` now accepts `getCustomProviders?: () => Promise<CustomProviderConfig[]>`.
    Custom providers are merged into the catalog after built-ins; they cannot
    shadow built-in ids.
  - Auth kinds supported for custom providers: `none`, `bearer`, `basic`,
    `api-key-header`. `google-service-account` and `oauth-bearer` are not
    supported (require out-of-band setup).
  - Credentials live in the existing secrets/credentials store — the provider
    row stores only credential key NAMES, never values.
  - SSRF guard (`isBlockedExtensionUrlWithDns`) is enforced at registration time
    and again at every request.

  **New Dispatch action: `provider-api-register`**

  Register, update, delete, or list custom providers:

  ```
  { operation: "upsert"|"delete"|"list"|"get",
    id, label, baseUrl, auth, docsUrls?,
    allowedHostSuffixes?, defaultHeaders?, notes?, scope? }
  ```

  **Updated Dispatch actions**

  `provider-api-catalog`, `provider-api-docs`, and `provider-api-request` now
  accept any provider id (built-in or custom) — the `provider` field is relaxed
  from `z.enum(BUILT_IN_IDS)` to `z.string()` with runtime validation against the
  merged registry. Unknown provider errors include the list of known provider ids.

  ***

  **Open docs fetching** in `provider-api-docs`

  `fetchProviderApiDocs` now allows ANY public `https`/`http` URL — not just
  URLs same-origin with registered `docsUrls`/`specUrls`. The SSRF guard and
  byte caps still apply. Registered docs/spec URLs remain available as curated
  starting points in the catalog output. The Dispatch `provider-api-docs` action
  description is updated to reflect this.

  ***

  **New `web-search` agent tool** (`packages/core/src/extensions/web-search-tool.ts`)

  Registers a `web-search` tool in dev and prod agent tool registries:
  - Input: `{ query: string, count?: number (default 5, max 10) }`.
  - **Pluggable backends** — at call time the first configured key wins:
    1. `BRAVE_SEARCH_API_KEY` → Brave Search API
    2. `TAVILY_API_KEY` → Tavily
    3. `EXA_API_KEY` → Exa
       Keys are resolved from the per-user/org credentials store first, then env vars.
  - Returns a title / URL / snippet list with guidance to follow up via
    `web-request` or `provider-api-docs`.
  - If no backend is configured, returns a helpful message listing the three keys.
  - Description: "Search the public web — use to find API docs, endpoints, or
    current information, then fetch promising URLs with web-request or
    provider-api-docs."

  **Framework secret registrations** (`register-framework-secrets.ts`)

  `BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY`, and `EXA_API_KEY` are registered as
  optional workspace-scoped secrets so they surface in the settings UI.

- 600f83d: Add `saveToFile` and `fetchAllPages` to `provider-api-request` and `saveToFile` to `web-request`.
  - `saveToFile?: string` on `provider-api-request` and `web-request`: writes full response
    body to a workspace file path instead of returning it in context. Allows up to 20 MB
    (vs normal 4 MB). Returns compact summary `{ savedToFile, savedTo, status, bytes, contentType, preview }`.
  - `fetchAllPages?: { cursorPath, cursorParam, itemsPath?, maxPages? }` on `provider-api-request`:
    generic cursor pagination — re-issues requests until cursor is empty or maxPages (default 10,
    max 50) is reached; accumulates items from `itemsPath`. Combines naturally with `saveToFile`.
  - `workspace-files` tool added to sandbox bridge default allowlist.

- 600f83d: Add `workspace-files` module: SQL-backed durable scratch storage for the agent.
  - New `workspace_files` table (scope/scope_id/path/content, unique per scope+path).
  - Per-file 2 MB cap, per-scope 200 MB cap with clear errors.
  - `workspace-files` agent tool (write/append/read/list/delete/grep actions).
  - Tool auto-registered in both dev and prod agent loops.
  - `workspaceRead`, `workspaceWrite`, `workspaceAppend`, `workspaceList` helpers
    available inside `run-code` sandbox via bridge.

## 0.46.0

### Minor Changes

- 66f8e32: Real-time collaboration improvements: security scoping, server performance, and client transport.

  **Security**
  - Tag collab poll events with `owner`/`orgId` when `resourceType` is configured so `getChangesSinceForUser` scopes delivery — users without access no longer receive Yjs bytes.
  - Awareness routes (`POST /awareness`, `GET /users`) already required a session; they now additionally enforce the configured resource access check.
  - Add a one-time server warning when `resourceType` is not set (collab events broadcast to all authenticated users).
  - Enforce a 2 MB payload limit on all collab write endpoints (`/update`, `/text`, `/search-replace`, `/json`, `/patch`); configurable via `maxPayloadBytes` plugin option.
  - Fix awareness outer-map memory leak: prune empty per-doc maps after all clients expire.

  **Server performance**
  - Remove redundant double DB read per mutation. The old code called `applyStoredState()` unconditionally before every write even on hot-cache hits; mutations now do a single SELECT inside `persistMergedState` (for CAS versioning only).
  - Add Yjs tombstone compaction: when the persisted blob is >4× the freshly encoded state, the GC'd form is stored, preventing unbounded blob growth without background jobs.
  - Cache-miss coalescing: concurrent `getDoc()` callers share a single DB load.

  **Client transport**
  - Debounce and coalesce local Yjs update POSTs (~80 ms) using `Y.mergeUpdates`; flush immediately on `visibilitychange`/`pagehide` and before each poll cycle.
  - State-vector fetches are gated: fetch only on reconnect, ring-buffer gap, or every 15th cycle (not on every cycle).
  - Exponential backoff with jitter (cap ~15 s) on consecutive network errors.
  - SSE fast-path: wire collab events via the existing `/_agent-native/poll-events` EventSource stream; relax poll to ~12 s while SSE is healthy, fall back to 2 s when SSE drops.

- 66f8e32: Add Presence Kit: Liveblocks/Figma-grade live-cursor and selection primitives.
  - **Fast awareness**: `useCollaborativeDoc` now POSTs awareness state changes within ~150ms (throttled trailing edge) instead of waiting for the 2s poll cycle. The `postAwareness` server handler emits an `AWARENESS_CHANGE_EVENT` that is forwarded through the `/_agent-native/poll-events` SSE stream to connected peers push-style. Polling-only deployments degrade gracefully to poll cadence.
  - **`usePresence(awareness, localClientId)`**: reactive hook that derives `OtherPresence[]` from awareness state. The agent (AGENT_CLIENT_ID) appears as a first-class participant with `isAgent: true`. Returns `setPresence(partial)` to publish arbitrary presence fields (cursor, selection, viewport).
  - **`LiveCursorOverlay`**: absolutely-positioned overlay that renders remote users' cursors from normalized 0–1 coordinates. The agent cursor uses a sparkle icon. Cursors fade out after 10s of inactivity with 120ms CSS transitions.
  - **`RemoteSelectionRings`**: renders colored outline rings + name tags over remotely-selected DOM elements using a `resolveRect` callback.
  - **`useFollowUser`**: invokes a callback when the followed participant's viewport changes, enabling follow-the-cursor navigation.
  - **`PresenceBar`** extended with `onAvatarClick` and `followingEmail` props for follow-mode UI with a blue ring indicator.
  - **`toNormalized` / `fromNormalized`**: coordinate helpers for converting pointer events to/from normalized presence coordinates.
  - **`getAwarenessEmitter` / `emitAwarenessChange` / `AWARENESS_CHANGE_EVENT`**: low-level emitter API for server-side awareness events.
  - Design template (`templates/design`) wired as the flagship consumer: live cursors over the canvas, avatar follow mode, and agent cursor plumbing in `edit-design` / `generate-design` actions.

## 0.45.1

### Patch Changes

- a2a3e52: Add CLI guardrails for unsupported Node versions and typo-like bare commands.
- a2a3e52: Encrypt OAuth tokens at rest. The `oauth_tokens` table previously stored the
  full bundle — including long-lived Google refresh tokens — as plaintext JSON,
  so a leaked DB backup / pg_dump / read replica exposed usable credentials.
  `saveOAuthTokens` now AES-256-GCM-encrypts the bundle with the same key story
  as the secrets vault and per-user credentials; reads decrypt transparently and
  fall back to plaintext for rows written before this change (and for Better
  Auth's mirrored `account` rows). Adds an optional, idempotent
  `db-migrate-encrypt-oauth-tokens` script to re-encrypt existing rows in place.

  Also exposes the AES-256-GCM helpers (`encryptSecretValue`,
  `decryptSecretValue`, `isEncryptedSecretValue`) from `@agent-native/core/secrets`
  and a focused `@agent-native/core/secrets/crypto` subpath, so templates can
  encrypt per-row secret values (e.g. a per-recording share password) that don't
  fit the keyed app_secrets / credentials stores.

- a2a3e52: Harden extension SQL filtering and expose shared secret encryption helpers.
- a2a3e52: fix(mcp): throw on corrupt JSON config instead of silently overwriting with empty object

  `readJsonFile` in `mcp-config-writers.ts` previously swallowed all read/parse errors and returned `{}`, meaning a corrupt or partially-written `~/.claude.json` (or `.mcp.json` / `~/.cowork/mcp.json`) would be silently replaced with only the new `mcpServers` entry — destroying the user's entire Claude Code state. Now only a missing or empty file yields `{}`; a non-empty file that fails to parse throws a descriptive error pointing to the file path and asking the user to fix or move it before re-running.

- a2a3e52: Allow `mcpApp: { compactCatalog: true }` without a `resource` so non-UI actions (read, update, list, share) can be flagged into the compact MCP Apps catalog independently of an iframe embed. Makes `resource` optional on `ActionMcpAppConfig` and updates `defineAction` to preserve the flag when no resource is provided.
- a2a3e52: Clean up ghost slash-command references in plan skills, fix Bidirectional Loop self-contradiction in visual-recap, add get-plan-blocks and Visibility & Sharing guidance to visual-plan, reword legacy "implementation maps" and "proof gates" framing, fix skill index and entry-point descriptions in AGENTS.md, align templates-meta.ts with shared-app-config, add publish-visual-plan and chat-host connector docs, and add context-xray to skills status/update usage.
- a2a3e52: Fix plan install flow: OAuth clients now get a publish token after `agent-native connect`, DEVELOPING.md is kept in standalone scaffolds, the Netlify `ignore` script line is stripped in scaffolds, and migration permission errors point to the app-prefixed DATABASE_URL workaround.
- a2a3e52: Fix nested interactive elements in question-form option previews, theme-aware iframe ink in the html block, click/focus/scroll fixes for annotated-code and diff annotation popovers.
- a2a3e52: Fix CLI safety issues: scope isFirstPartyPlanHost to plan.agent-native.com only, exclude diff headers from countDiffLines, raise waitForPublicRecapImage retry budget to ~20s, detect git failures in collect-diff, guard codex mcp-config against clobbering existing config, require PLAN_RECAP_TOKEN for claude mcp-config, and fix plan-local unknown-area exit code.
- a2a3e52: Fix several PR Visual Recap pipeline reliability issues:
  - **playwright optionalDependency**: add `playwright@^1` as an `optionalDependency` of `@agent-native/core` so consumer repos running `npx @agent-native/core@latest` can take screenshots without manual install steps; the existing dynamic-import fallback chain is preserved.
  - **plan-id continuity**: `buildCommentBody` now threads the last-known plan id (`PREV_PLAN_ID`) into every comment branch (failure, suppressed, tiny) so a transient error never orphans the plan; the failure branch also keeps a labeled stale link to the previous recap.
  - **freshness line**: all comment branches that have a `HEAD_SHA` now emit `_As of \`<short-sha>\`\_` so reviewers can tell whether the recap matches the latest push.
  - **deterministic visibility**: `create-visual-recap` action accepts a `visibility` input (enum `private|org|public`, default `org`) and applies it server-side after import, so the recap is never accidentally private; the agent prompt now passes `visibility: "org"` in the `create-visual-recap` call and demotes `set-resource-visibility` to a fallback note.
  - **playwright browser cache**: adds an `actions/cache` step for `~/.cache/ms-playwright` (keyed on runner OS + playwright major) to avoid re-downloading Chromium on every workflow run.
  - **guard scoping**: the `packages/core/**` self-modifying guard in the gate now only triggers for the `BuilderIO/agent-native` monorepo; consumer repos with an unrelated `packages/core/` directory no longer have their recaps silently gated.

- a2a3e52: Remove legacy Plan skill variants from packaged skill installs, move wireframe guidance into references, add copied-skill status/update metadata, and harden visual recap comments and image embeds.
- a2a3e52: Improve PR Visual Recap setup UX with an optional Plans install prompt, `agent-native recap setup`, and `agent-native recap doctor`.

## 0.45.0

### Minor Changes

- 06397b2: Add DB-free local-files helpers for Agent-Native Plans and Visual Recap prompts.

### Patch Changes

- 06397b2: Fix the Cloudflare Pages deploy build failing on every attempt: externalize `@anthropic-ai/tokenizer` (tiktoken `.wasm`) and `@resvg/resvg-js` (native `.node`) from the worker bundle — esbuild has no loaders for those files, and both import sites already degrade gracefully (char/4 token estimates, SVG OG-image fallback). Teach `isResvgRuntimeUnavailableError` workerd's "No such module" wording so the OG route falls back to SVG instead of erroring. Also guard `e.key.toLowerCase()` keyboard shortcut handlers against undefined `e.key` (autofill/IME keydown events), which crashed the composer in production.
- 06397b2: Prefer the left gutter for annotation hover cards when the right side overflows.
- 06397b2: Stop Neon WebSocket drops from surfacing as unhandled `[object ErrorEvent]` promise rejections. Fire-and-forget DB writes (agent-team run heartbeats and progress saves, desktop-exchange cleanup) now catch and log connection failures with context via a new `describeDbError` helper — which also makes the Neon pool/client error logger print the ErrorEvent's actual message instead of `[object ErrorEvent]`. The server Sentry filter now recognizes bundled SDK chunks (e.g. `/var/task/_libs/@sentry/...`) as non-application frames so SDK-only rejection stacks from serverless bundles are dropped as intended.
- 06397b2: Hide redundant language badges on read-only code surfaces when a filename is already shown, and render code filenames with a muted path prefix.
- 06397b2: Add a lightweight `agent-native reconnect` CLI reauth path and harden remote MCP OAuth auth handling.
- 06397b2: Pass repository context into PR visual recap prompts so generated recaps can link back to their source pull requests.
- 06397b2: Restore split diff defaults for visual recaps and steer key-file recap diffs back to horizontal tabs.
- 06397b2: Show PR Visual Recap generation as an informational GitHub check run while it is running.

## 0.44.4

### Patch Changes

- 5a18db9: Remove the special background tint from the question-form submit footer.
- 5a18db9: Hide JSON explorer bulk actions until hover and disable redundant actions.
- 5a18db9: Keep question-form send menus compact and copy-first without edit-by-prompt chrome.
- 5a18db9: Remember the user's unified/split diff view preference in localStorage.
- 5a18db9: Reduce plan code font sizing.
- 5a18db9: Lock annotated-code hover popovers to the first line of a multi-line annotation range.

## 0.44.3

### Patch Changes

- 5b37b89: Add a 2-minute per-attempt timeout to the Builder.io file upload provider fetch so large-image uploads fail with a clear error instead of hanging indefinitely. Retries on network errors are also now handled consistently with the existing 5xx retry path.

## 0.44.2

### Patch Changes

- 1b6f2f4: Fix apps stuck on the `ClientOnly` loading spinner after sign-in when Vite 8's Rolldown dependency optimizer mis-bundled `recharts` → `es-toolkit` CJS compat (`require_isUnsafeProperty is not a function`). Exclude those packages from `optimizeDeps`, allow workspace root `node_modules` in dev server `fs.allow`, and lazy-load Context X-Ray so the treemap is not on the critical startup path.

## 0.44.1

### Patch Changes

- 9c5ba15: Block-library refinements: `ApiEndpointBlock`, `AnnotatedCodeBlock`, `DiffBlock`,
  and the `diagram` block (with added test coverage), plus shared `blocks.css`
  adjustments. No public API changes — these tighten rendering and styling of the
  shared plan/content blocks that live in core.
- 9c5ba15: Fix blank text in the default social/OG preview image (`/_agent-native/og-image.png`).
  Linux serverless runtimes (Netlify/Lambda) ship neither Arial nor Inter, so resvg
  had no font to render with and every `<text>` element came out empty — the card
  showed only the logo and grid. The renderer now bundles Liberation Sans (a
  metric-compatible Arial replacement) embedded as base64 and passes it to resvg via
  `fontFiles`, independent of host system fonts. Also fixes the display title
  rendering thin: resvg's fontdb maps `font-weight: 850` to Regular, so the title now
  uses `800`, which resolves to Bold.
- 9c5ba15: Composer: pasting an HTML document now behaves like uploading that `.html` file.
  Page-sized pastes already convert to a "Pasted text" attachment chip, but the
  composer only ever read the clipboard's `text/plain` flavor and labelled the chip
  a generic `pasted-text-*.txt`. When a user pasted HTML to host as an extension,
  the agent received a nondescript text blob — so instead of reading it verbatim via
  `contentFromAttachment`, it re-emitted the markup inline as a tool argument, which
  cut off mid-stream on large files and degenerated into a continuation loop (the
  chat "spun for a while"). Uploading the same content as a file worked because the
  file carried the real HTML with a recognizable name/type.

  `TiptapComposer`'s paste handler now captures the clipboard's `text/html` flavor
  and, when the pasted content is an HTML document/source, stores it as a real
  `pasted-text-*.html` attachment (`text/html`) with the markup preserved verbatim —
  so paste and file-upload travel the identical attachment rail. Plain prose and
  code stay `.txt` (the detection keys off the pasted content, not the `text/html`
  flavor, so editor syntax-highlight markup and Google Docs formatting don't
  mis-promote plain code/prose to HTML).

- 9c5ba15: Capture LLM token usage and a derived cost estimate for PR Visual Recaps. The
  recap workflow now emits machine-readable usage from the Claude Code / Codex run
  and a new `agent-native recap usage` CLI subcommand parses it (normalizing the
  Anthropic-vs-OpenAI cache-token accounting asymmetry) and attaches it to the
  published recap. `recordUsage` gains optional `refId` (idempotent
  replace-on-rewrite) and `costCentsX100` (store a provider-reported cost
  verbatim) fields plus a `ref_id` column, and the model pricing table gains
  OpenAI `gpt-5` / `gpt-5.5` rows so Codex recaps are not priced as Sonnet.

## 0.44.0

### Minor Changes

- 4e55e6d: Consolidate the plan block set into the shared core block library so any app that
  registers the library (plan, content, future templates) gets the same rich blocks
  — and cut the redundant `decision` block.
  - Moved into the shared library: `callout`, `question-form`, `visual-questions`,
    `diagram`, and `wireframe` (plus the wireframe-kit primitives in
    `library/wireframe-kit.tsx`). Each ships a React-free `*.config.ts` (schema +
    MDX) and a `*.tsx` (`Read`/`Edit` + spec), is registered in both
    `libraryBlockSpecs` (client) and `libraryBlockConfigs` (server), and is exported
    from the blocks entry. They're decoupled from any single app: no shadcn imports
    in core (popovers go through `ctx.renderEditSurface`), and HTML-bearing blocks
    self-sanitize via the shared `library/sanitize-html.ts` (DOM-based in the
    browser, regex fallback on the server).
  - The shared block CSS "contract" now lives in core `styles/blocks.css` (imported
    by `agent-native.css`): block label / code-surface / prose / annotation rules,
    the `text/bg/border-plan-*` color utilities, the app-neutral `an-callout` tone
    styling, and the wireframe-kit + inline-diagram styling — all resolving against
    shadcn theme tokens (with plan-var-with-theme-token fallbacks for the migrated
    wireframe/diagram CSS) so blocks render in any app's palette. Because
    `blocks.css` loads before a template's `global.css`, the plan template's
    existing rules still win there, so plan renders unchanged.
  - `BlockRenderContext` gains optional `onQuestionFormSubmit(summary)` so the
    shared question-form / visual-questions blocks route answers back to the host
    without app-specific wiring.
  - `BlockRegistry.register` now OVERRIDES on a duplicate block `type`/`tag`
    (last-registration-wins) instead of throwing — lets an app override a library
    block and makes module-level registration idempotent under dev HMR (which
    otherwise crashed with "Block type … is already registered").
  - Removed the `decision` block (it duplicated a `callout` with `tone:"decision"`
    plus a `columns`/list comparison). It's gone from the registry, agent
    vocabulary, slash menus, and the plan skills (which now steer to callout +
    columns). Because `decision` was also a legacy member of plan's stored-content
    schema, a content migration rewrites any stored decision block into a
    decision-tone `callout` on load (question + options in the body, recommended
    flagged) so existing plans keep loading and rendering. `callout`'s `decision`
    tone is retained.

### Patch Changes

- 4e55e6d: Plan/editor block drag-handle menu now uses real Tabler icons instead of
  hand-drawn CSS pseudo-element glyphs. The Delete item rendered a malformed,
  oversized trash shape; Duplicate, Delete, and Insert-block-below now inline the
  verbatim Tabler `copy`, `trash`, and `plus` outline SVGs (matching the
  framework-wide `@tabler/icons-react` set), and the left-margin grip uses Tabler
  `grip-vertical`. The editor is plain DOM (not React), so the markup is inlined
  rather than imported. Removed the now-unused `--duplicate`/`--delete`/`--insert`
  pseudo-element drawing rules from the injected menu stylesheet.
- 4e55e6d: Make the agent sidebar paint faster, especially for a new chat.
  - **New chat no longer shows a loading skeleton.** The empty state previously
    rendered a suggestion skeleton that was gated on `suggestionsLoading` — which
    waits on four `application-state` reads (and re-runs every 2s). Suggestions are
    non-essential garnish, so the empty state (icon + composer) now renders
    immediately and suggestion chips appear when ready, instead of holding a
    skeleton on a brand-new chat that has nothing to load.
  - **Opening an existing thread clears its skeleton sooner.** Thread restore no
    longer gates first paint on the `reconnectActiveRunForThread()` probe: the
    skeleton clears as soon as the persisted messages are imported, and the
    active-run reconnect (only relevant mid-run, e.g. after a hot reload) runs
    afterward and streams on top of the already-rendered conversation.

- 4e55e6d: Speed up the agent sidebar and per-session polling.
  - **Chat thread list** (`chat-threads/store.ts`): the sidebar list query no longer
    selects the full `thread_data` JSON blob (every thread's entire message
    history, tool results, and attachments) just to render titles and previews —
    it now reads only the summary columns and derives "has messages" from the
    `message_count` column instead of a `LIKE '%"messages"%'` scan over the blob.
    Legacy rows are backfilled once so none drop out of the list. Added
    `(owner_email, updated_at)` and `(scope_type, scope_id, updated_at)` indexes on
    `chat_threads` so the list is an indexed lookup instead of a full table scan +
    sort. The thread detail/get path still returns the full `thread_data`, and the
    compare-and-swap write path is unchanged. Indexes are dialect-agnostic.
  - **Change-detection poll** (`server/poll.ts`): the independent reads in
    `doCheckExternalDbChanges()` now run concurrently via `Promise.all` instead of
    sequential awaits, cutting per-poll round-trips on the common path from ~6 to
    effectively 1. Dependent/conditional follow-up queries stay ordered, and
    change-emit order, early-exit semantics, and error handling are unchanged.

- 4e55e6d: Add a `performance` agent skill (DB-provider-agnostic) covering the load-speed
  best practices apps and templates should follow: project columns on list
  endpoints (never `SELECT *` heavy blobs), index hot-path queries
  (`owner_email`/`org_id`/sort, `*_shares.resource_id`, child foreign keys, status
  filters) via the versioned migration array, avoid N+1 and round-trip waterfalls,
  poll cheaply, don't recompute on every read, and paginate unbounded lists. The
  skill ships into generated workspaces via `workspace-core` and is cross-linked
  from `storing-data`.
- 4e55e6d: `SharedRichEditor` / `createSharedEditorExtensions` gain an optional
  `disableHistory` flag that turns off StarterKit's built-in undo/redo
  (prosemirror-history) for a controlled, non-collaborative editor whose host owns
  its own undo authority. Defaults to `false`, so every existing embedder is
  unchanged; when a collaborative `ydoc` is present, undo/redo stays disabled
  regardless (Yjs owns history, as before). The plan editor uses this so a single
  app-level undo stack — over its authoritative `blocks[]` tree, which holds block
  data the ProseMirror doc never stores — can be the sole cmd+z authority, fixing
  undo/redo for block drag-reorder, cross-region moves, and block option/config
  edits (none of which PM history could see or reliably revert).
- 4e55e6d: Stop a lagging content poll from briefly reverting a just-applied local edit in
  the shared rich-markdown reconcile (`useCollabReconcile`).

  When a structural edit (e.g. a Notion-style drag-to-columns) is applied locally
  and the editor is then blurred — the drag grips the handle, not the prose, so
  `isFocused` is false at drop time — a `get-visual-plan`/source poll that
  re-supplies the older pre-edit content (older-or-equal `contentUpdatedAt`) was
  applied through `setContent`, reverting the new layout. A moment later the save
  round-tripped and the next poll restored it: the "drop works, then undoes, then
  comes back" glitch.

  The reconcile already dropped older-or-equal external content while focused (a
  real peer/agent edit is always newer and retries). In NON-COLLAB editors there
  is no peer, so older-or-equal content is ALWAYS a stale poll/echo — it is now
  dropped regardless of focus (gated on having already seeded, so the first apply
  still lands). Collab editors are unchanged: a peer edit arriving while you are
  away still applies.

- 4e55e6d: Reduce agent-sidebar chat jank by skipping redundant thread re-imports on poll
  ticks (`AssistantChat`'s `importThreadData`).

  The real-time sync layer refetches the open thread (`/threads/:id`, or re-runs a
  host `loadHistoryRepository`) on reconnect, on `historyReloadKey` bumps, and on
  restore. Each call ran the full `JSON.parse` + `normalizeThreadRepository` +
  `threadRuntime.export()`/`import` round-trip even when the payload was identical
  to what was last imported — CPU-bound on long threads and a source of needless
  re-render churn.

  `importThreadData` now hashes the raw incoming payload and short-circuits when it
  matches the last successfully-imported signature, returning the already-imported
  repo. Any real change (new message, arriving tool result, server replacing an
  optimistic copy, switching threads) produces a different signature and falls
  through to a full import. Payloads that `shouldImportServerThreadData`
  deliberately rejects are not cached, so rejection semantics and live token
  streaming are unchanged.

## 0.43.0

### Minor Changes

- 4682bb6: Move the full plan-specific block set into the shared core block library so any
  app that registers the library (plan, content, future templates) gets every rich
  block — not just plan.
  - New shared library blocks: `callout`, `decision`, `question-form`,
    `visual-questions`, `diagram`, and `wireframe` (plus the wireframe kit
    primitives in `library/wireframe-kit.tsx`). Each ships a React-free
    `*.config.ts` (schema + MDX) and a `*.tsx` (`Read`/`Edit` + spec), is added to
    both `libraryBlockSpecs` (client) and `libraryBlockConfigs` (server), and is
    exported from the blocks entry. They are decoupled from the plan app: no
    `@/components/ui` / shadcn imports (popovers go through `ctx.renderEditSurface`),
    and HTML-bearing blocks self-sanitize via the new
    `library/sanitize-html.ts` (DOM-based in the browser, regex fallback on the
    server) instead of relying on a host-wired hook.
  - The shared block CSS "contract" now lives in core `styles/blocks.css`
    (imported by `agent-native.css`): the generic block label/columns/code-surface/
    prose/annotation rules, the `text/bg/border-plan-*` color utilities, the
    app-neutral `an-callout` tone styling, and the wireframe-kit + inline-diagram
    styling. Colors resolve against shadcn theme tokens (`--foreground`,
    `--muted-foreground`, `--border`, `--muted`) — or, for the migrated wireframe/
    diagram CSS, against plan vars with theme-token fallbacks — so the blocks render
    in any app using that app's palette. Because `blocks.css` loads before a
    template's `global.css`, the plan template's existing rules still win there, so
    plan renders unchanged.
  - `BlockRenderContext` gains an optional `onQuestionFormSubmit(summary)` hook so
    the shared question-form/visual-questions blocks can route answers back to the
    host without importing app-specific submit wiring.
  - `BlockRegistry.register` now OVERRIDES on a duplicate block `type`/`tag`
    (last-registration-wins) instead of throwing. This lets an app override a
    shared library block with its own variant and makes module-level registration
    idempotent under dev HMR (which could otherwise re-run a registration module
    against a surviving registry and crash with "Block type … is already
    registered"). A stale MDX-tag mapping is dropped when a re-registered type
    changes its tag.

  Plan's local registration of these blocks (client + server) is removed in favor
  of the shared library copies; plan now registers no app-only blocks.

### Patch Changes

- 4682bb6: Make the Notion-style side drop (drag a block to a neighbour's left/right edge to
  build columns) reliably hittable for a real human in the `DragHandle` extension.

  The side (column) activation region was a thin edge sliver in the vertical
  middle: 28% of the block width capped at 140px, AND only the middle 60% of the
  height. On a typical ~820px plan block that left two ~17%-wide edge zones in a
  35px-tall band as the only column targets — the entire centre and the top/bottom
  slivers reordered instead. A natural "drag beside" gesture released over the
  block body, so it almost always reordered and "dragging side by side never made
  columns" (and even when the indicator flashed, a human's release drifted out of
  the tiny zone before mouse-up).
  - Each side zone now claims ~a third of the block width (`SIDE_DROP_ZONE_RATIO`
    0.28 → 0.33, max cap 140 → 320px, min 48 → 56px) and is clamped to at most 45%
    of the width so a centre before/after reorder lane always survives.
  - Side zones now span the FULL block height (the vertical-middle-only band is
    removed) — only the horizontal position decides column-vs-reorder.
  - The drop indicator gets a `notion-drop-indicator--column` modifier class and is
    drawn as a thicker (4px) vertical bar centred on the seam, so apps can style
    column-build mode distinctly from the thin horizontal reorder line.

  Editors that do not opt into `handleDrop` (e.g. the content editor) are
  unaffected — side placements stay gated on `handleDrop` existing.

  Also fixes the drag grip disappearing before you can grab blocks that are not
  flush with the page's left gutter (a right column, a tab body). Their grip sits
  in a gap the neighbour's wide forgiving hover zone also claims, so moving the
  cursor from the block body toward its grip re-picked hover to the neighbour and
  the grip vanished mid-approach. A grip keepalive now holds the shown grip while
  the cursor travels left of that block's content toward its glyph (bounded to the
  block's own row), so the grip stays grabbable — without changing the
  innermost-wins or gutter-grab behaviour over content.

- 4682bb6: Refine the `file-tree` block for the recap "Files touched" rail. Folder/file
  rows and the summary title drop a touch (14px → 13px) so the dense explorer
  reads a step below body text. The block now sets `data-files-expanded` on its
  root while a file's note/snippet is the reader's active focus, which the plan
  left rail uses to widen into a flyout over the document and collapse back to a
  slim rail when focus leaves or the last open file is closed.
- 4682bb6: Plan renderer + skill polish from review feedback:
  - `checklist` block read view now wraps long item labels instead of clipping
    them off the right edge (`min-w-0 flex-1` body, `shrink-0` marker,
    `break-words`), and tightens the inter-item gap from `gap-3` to `gap-2`.
  - Plan skill `DOCUMENT_QUALITY_CORE` (shared by `/visual-plan` and `/ui-plan`)
    now states that the bottom `question-form` is the ONLY place that enumerates
    open questions — a one-line pointer in the overview is fine, but the question
    list must not be reproduced as a second "Open Questions" section earlier in
    the document.

## 0.42.0

### Minor Changes

- 58676e6: `app-skill` packer now generates auto-updating plugin manifests so installed plugins pick up skill changes without a manual re-pack: Claude Code marketplace entries set `autoUpdate: true` (with commit-SHA plugin versioning) and Codex plugin versions embed a content hash of the bundled skills plus the MCP endpoint. This backs distributing the Agent-Native Plan app (and any app-backed skill) as a one-install Claude Code / Codex marketplace plugin that bundles the skills and the hosted MCP connector together.

### Patch Changes

- 58676e6: Fix fresh-install scaffold builds failing on `@assistant-ui/tap/react-shim`.
  Newly published `@assistant-ui/store@0.2.14` bumped its `@assistant-ui/tap` peer
  to `^0.6.0` and started importing the `@assistant-ui/tap/react-shim` subpath,
  which exists **only** in tap 0.6.0. But `@assistant-ui/react@0.12.x` (our pin)
  still depends on `@assistant-ui/tap@^0.5.x`, so the single hoisted tap resolves
  to 0.5.14 — which has no `react-shim` export. A lockfile-less `pnpm install`
  (the scaffold E2E CI job and any freshly-created app) floated `store` to 0.2.14
  and the calendar build then failed under Rolldown/Vite with:

  ```
  "./react-shim" is not exported … from package @assistant-ui/tap
  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  calendar@ build: `agent-native build`
  ```

  Pin `@assistant-ui/store` to `0.2.13` (the latest release that still peers
  `@assistant-ui/tap@^0.5.x` and does not import `react-shim`) and add an explicit
  `@assistant-ui/tap@^0.5.14` so the whole `@assistant-ui/*` family resolves to a
  self-consistent, tap-0.5.x generation (react 0.12.28 · store 0.2.13 · core
  0.1.17 · tap 0.5.14) on a clean install. No app-code changes — assistant-ui
  is consumed exactly as before.

- 58676e6: Before/after comparisons in plans and visual recaps now label their states with
  the column header instead of a pill baked into the wireframe, and wide frames
  stack instead of cropping.
  - The `columns` block renders each column's `label` (e.g. `Before` / `After`) as
    a small `<h4 class="plan-columns-label">` heading **above** that column, in
    both the read and edit surfaces. The state name lives outside the content, so
    authors no longer write a `Before`/`After` pill inside a child wireframe's
    mockup (where it read as part of the product UI and landed in a random corner).
  - A comparison whose columns hold a wide wireframe (`surface: "desktop"` or
    `"browser"`) now lays out as a single vertical stack at full document width
    instead of two half-width cells, so a large frame is never squeezed and
    cropped. Narrow surfaces (`mobile`, `popover`, `panel`) stay side by side.
  - The `visual-plan` / `ui-plan` / `visual-recap` skills' shared Wireframe Quality
    core is updated to teach this: name states with the column header (never inside
    the frame) and let the surface choose side-by-side vs. stacked.

- 58676e6: Rich-markdown drag handle: make container blocks (`columns`, and any nested-region
  block) draggable to reorder again. Each column inside a `columns` block mounts its
  own nested editor that tiles the container's full footprint and extends an 8rem
  forgiving hover zone into the container's left-margin gutter. The grip's
  "smallest editor wins" hover arbitration therefore handed the gutter to the inner
  column editor everywhere, so the outer `columns` block (e.g. a before/after
  wireframe pair in a visual plan) could never be selected or dragged.

  Hover arbitration now splits candidates by cursor position: over a block's body
  the innermost (smallest) editor still wins so nested blocks stay grabbable from
  their content, but in the shared left-margin gutter where the grip lives the
  outermost (largest) editor wins so the container can be picked up and reordered.
  Sibling non-container blocks are unaffected.

- 58676e6: `create-extension` and `update-extension` can now host a large pasted file by
  reference. When a user pastes a big HTML/Alpine file and asks to host it as an
  extension, the model passes `contentFromAttachment` (the pasted attachment's
  name, or the literal `"latest"`) instead of copying the whole file into the
  `content` tool argument. The server resolves it from the turn's attachments —
  which the agent loop now threads into each action's `ActionRunContext` — so the
  model never re-emits thousands of tokens of pasted content.

  Re-emitting a large paste as `content` was the root cause of the
  create-extension continuation loop the repetition guard mitigates; this removes
  the need to regurgitate it at all. The inline `content` path is unchanged.

- 58676e6: Registry block-node legacy-block editing. Legacy (unregistered) document blocks
  can now either:
  - render their own self-contained edit overlay via a `legacyBlockSelfEdits`
    side-map predicate — the node view renders the block in edit mode and adds NO
    separate corner edit surface (no pencil/JSON/form popover), so the block owns a
    single control overlay (e.g. an image block with one hover toolbar); or
  - supply a schema-driven form editor via the `renderLegacyBlockEditor` side-map
    hook, rendered in the block-edit popover instead of the raw-JSON fallback.

  The raw-JSON fallback editor's Save button is also right-aligned instead of
  stretching full-width.

- 58676e6: Fix dragging blocks by the grip when they live inside a container block
  (columns/tabs). A container block's node view runs its `onMouseDownCapture`
  block-select handler in its own React root, so its `stopPropagation()` halted the
  native `mousedown` before it ever reached an inner editor's drag-handle grip —
  nested column blocks could not be picked up at all, so dragging a block OUT of a
  column, BETWEEN columns, or onto another block to make new columns silently did
  nothing. Two parts: `clickedInteractiveChild` now treats the drag handle and any
  target inside a nested editor region as interactive (so the container spares a
  mousedown meant for an inner grip), and the grip's icon is now
  `pointer-events:none` so a real mouse-down — which lands on the SVG, not the grip
  `div` — resolves to the grip itself instead of being swallowed.

  Also adds an optional `onEditorReady` callback to the shared rich-markdown editor
  so a host can capture the root editor view (used by the plan editor to rebuild
  the document when a column move dissolves its container).

- 58676e6: PR Visual Recap: make the Codex backend actually work in CI. Two fixes:
  1. **Auth.** The `Run agent (Codex)` step now pipes `OPENAI_API_KEY` into
     `codex login --with-api-key` (writing `~/.codex/auth.json`) before
     `codex exec`, instead of relying on the bare environment variable. On the
     `gpt-5.5` WebSocket transport Codex was dropping the `Authorization` header on
     the `wss` path and its HTTPS fallback, so every recap failed with `401 Missing
bearer or basic authentication in header` and the PR comment reported
     "generation failed".
  2. **Sandbox + approvals.** `codex exec` now runs with
     `--dangerously-bypass-approvals-and-sandbox` instead of
     `--sandbox workspace-write`. Codex's bundled bubblewrap sandbox cannot
     initialize on the GitHub runner, so every shell command failed at startup and
     the agent could not read `recap.diff`; and under an approval gate the
     write-side plan MCP call (`create-visual-recap`) was auto-cancelled. The
     runner is itself an ephemeral throwaway sandbox, so this is the documented CI
     invocation.

  Both fixes land in the in-repo workflow and the bundled copy the CLI writes into
  consumer repos (kept byte-identical by the recap sync test).

- 58676e6: PR Visual Recap: restore the inline screenshot in the sticky PR comment. The
  recap's PNG upload to `POST /_agent-native/recap-image` was silently failing, so
  `recap shot` returned an empty `imageUrl` and the comment fell back to a
  link-only body.

  Root cause: h3 v2's `readRawBody(event, false)` resolves a bare `Uint8Array`,
  not a Node `Buffer`. The route then called Buffer-only methods on it — the PNG
  magic-byte check (`Buffer#equals`) _threw_ (`.equals` doesn't exist on a
  `Uint8Array`), surfacing as a 500 so the CLI saw `!res.ok`; and even past that,
  the store's `png.toString("base64")` would have silently mis-encoded the bytes
  (a bare `Uint8Array` ignores the encoding argument). The upload route now
  normalizes the body to a `Buffer` once before the magic-byte check and storage,
  so both the raw `image/png` and JSON `{ pngBase64 }` paths persist the exact
  bytes uploaded.

  `recap shot`'s image-upload helper now also logs the HTTP status / response
  snippet to stderr on failure (stdout still carries only the machine-readable
  JSON the workflow parses), so a future upload failure is debuggable from the CI
  log instead of vanishing into a null `imageUrl`. The route's unit test mock now
  mirrors h3 v2 by handing the handler a real `Uint8Array`, which would have
  caught the original regression.

- 58676e6: Recap code-diff blocks: fix duplicate/loading tab content, render per-diff
  descriptions, and steer recaps toward a labeled "Key changes" section.
  - **Diff `summary` now renders as a description above the code** (previously a
    trailing note below it), so a one-line "what this hunk changes and why" reads
    before the diff — the natural order for a review recap.
  - **`visual-recap` skill** now instructs the recap generator to give every
    `diff` a one-line `summary`, and to introduce a group of file diffs with a
    `## Key changes` rich-text heading rather than relying on a `tabs` block title.
    All four skill copies stay byte-identical (guarded by `skills.sync.spec.ts`).

  These pair with a plan-template fix where switching tabs in a vertical `tabs`
  block (the recap "Key changes" diff rail) reused one nested editor instance, so
  its content reconciler skipped re-applying the newly-selected tab — surfacing as
  "every tab shows the same diff" and a stuck "Loading diff block…". The nested
  editor is now keyed per container region so each tab remounts with its own
  content.

- 58676e6: Agent chat now bails out of a degenerate repetition loop quickly instead of
  burning the entire auto-continuation budget. When the model gets stuck
  re-streaming the same narration every continuation without ever finishing a
  tool (the classic "paste a large HTML file and ask to host it as an extension"
  failure), it previously counted each repeat as progress and ran all 32 transient
  continuations — re-sending the large pasted payload each round — before surfacing
  a generic `connection_error`. A new repetition guard detects the non-advancing
  loop and stops after a few rounds with a clear, actionable message, and the
  `create-extension` large-payload nudge now also fires on mid-stream cutoffs
  (`stream_ended`), not just run timeouts.
- 58676e6: The `/visual-plan` skill now prescribes a gated, read-only, non-blocking
  adversarial self-review before handoff: surface the plan first, then spawn one
  skeptical reviewer (concurrently, against the written plan only — no
  re-research) for high-stakes architecture/backend/data/multi-file plans, apply
  clear-cut fixes via `update-visual-plan` patches, and route genuine judgment
  calls back to the user. Plan Discipline also gains a reuse-first instruction
  (name what each step reuses before what it adds) and a "decide the hard-to-
  reverse bets first" instruction (settle wire format, public ids, data-model
  shape, auth, and ownership before scoping to the smallest first cut). The
  guidance is byte-synced across the shipped skill constant, the template copy,
  and the exported mirror.

## 0.41.1

### Patch Changes

- 0ce463c: Constrain `@assistant-ui/store` (`>=0.2.9 <0.2.14`) and `@assistant-ui/tap` (`^0.5.14`) as direct dependencies so the breaking `store@0.2.14`/`tap@0.6.0` combination can't be selected transitively via `@assistant-ui/react@^0.12.x`. This prevents the `./react-shim` / `./react` export resolution failures during Vite dependency pre-bundling and production builds.

## 0.41.0

### Minor Changes

- 520d641: Add global (admin) hide for extensions. The `tools` table gains additive
  `hidden_at` / `hidden_by` columns (distinct from the existing per-user
  `tool_hidden_extensions` hide). When set, the extension is hidden from
  everyone's Extensions list/sidebar without being deleted.
  - `listExtensions` now excludes globally-hidden extensions by default and
    accepts `includeGloballyHidden: true` to surface them.
  - New store helpers `globalHideExtension` / `globalUnhideExtension` (require
    owner/admin access) and new agent actions `global-hide-extension` /
    `global-unhide-extension`. `list-extensions` accepts `includeGloballyHidden`
    and reports `globallyHidden` / `hiddenAt` / `hiddenBy` per extension.
  - The extensions list endpoint accepts `?includeGloballyHidden=true`.
  - The Extensions sidebar and list page add a "Hide from everyone" /
    "Unhide for everyone" affordance for admins plus a "Show hidden" toggle.

- 520d641: Notion-style code blocks for the shared editor and plan surfaces. The rich
  markdown editor's fenced code blocks now render through a shared
  `createCodeBlockNode` node view with a language picker header (Auto-detects by
  default) instead of a bare highlighted `<pre>`, and the editor code surface
  follows the app's light/dark `--muted`/`--foreground`/`--border` tokens instead
  of a hardcoded dark navy. The read-side `CodeSurface` (code tabs, API specs,
  markdown read view) gains a language label and collapses long snippets behind a
  "Show N more lines" toggle (default 30 lines, configurable per code tab via the
  new `maxLines` field, `0` to disable) rather than scrolling a fixed-height box.
  New exports: `createCodeBlockNode`, `DEFAULT_CODE_LANGUAGES`, `CodeSurface`,
  `HighlightedCode`, `prettyLanguageName`, `DEFAULT_CODE_MAX_LINES`.
- 520d641: PR Visual Recap is now LLM-driven. Instead of a deterministic diff→MDX
  generator, the `pr-visual-recap` GitHub Action runs the repo's `visual-recap`
  skill via a real coding agent (Claude Code by default, or Codex — selected with
  the `VISUAL_RECAP_AGENT` repo variable), which publishes the plan through the
  plan MCP tools. The workflow screenshots the published plan in headless Chrome,
  uploads it to the new signed `recap-image` route, and posts the screenshot
  inline in the sticky PR comment.

  New CLI surface backing the action:
  - `agent-native recap <scan|build-prompt|shot|comment>` — the helper commands
    the workflow calls (no helper scripts are copied into the consuming repo).
  - `agent-native skills add visual-plan --with-github-action` — installs the PR
    Visual Recap workflow into a repo and prints the secrets/variables to set.

  The agent-produced plan URL is treated as untrusted throughout: the screenshot
  CLI only forwards the publish token to requests whose origin matches the plan
  app (so a poisoned `recap-url.txt` can't exfiltrate it to a third party or via
  cross-origin subresources), and the workflow passes the URL through the
  environment rather than `${{ }}` shell interpolation. The workflow runs on PRs
  into any base branch (not just `main`) so the generated workflow works in repos
  with a different default branch.

- 520d641: Add a standard `code` dev-doc block: a single syntax-highlighted snippet
  (Notion-style — one border, hover-revealed language switcher + copy button,
  collapse-to-N-lines) with an optional filename header. It is the primitive code
  block; a multi-file "rail" is just a `tabs` block containing `code` blocks, so
  there is no bespoke container. The legacy `code-tabs` block stays renderable for
  stored documents but is no longer authored. The pure schema/MDX config lives in
  `code.config.ts` (React-free, safe for the server MDX adapter and SSR bundle).

### Patch Changes

- 520d641: annotated-code: mute the per-annotation line-range label (`LINES 3–6` / `LINE 8`) to a quiet gray (`text-plan-muted`) instead of bright amber, so the range reads as secondary metadata and the annotation label stays the focus.
- 520d641: Plans docs now lead with the two-command story — `/visual-plan` (plan before
  implementation) and `/visual-recap` (review a change that already landed).
  Documented `/visual-recap` on the Plans (`template-plan`) and Visual Plans pages,
  cross-linked PR Visual Recap, and stopped documenting the `/ui-plan`,
  `/prototype-plan`, `/plan-design`, and `/visual-questions` companion commands as
  separate surfaces (their capabilities are folded into `/visual-plan`). The skills
  themselves are unchanged.
- 520d641: Re-add and redesign the `annotated-code` dev-doc block for Plans/Content (block
  source, client/server registries, schema, slash menu, and skill guidance).

  The read view now renders a standard syntax-highlighted code surface (shared
  `code-highlight` lowlight palette, matching the `code-tabs` block) with a
  highlight band + accent rail on annotated line ranges and the notes as
  always-visible cards to the side (Stripe-docs "explain this code" layout).
  Code lines render as spans rather than one `<pre>` per line, so they no longer
  pick up document code/pre chrome, and the surface is theme-aware in light and
  dark. Restores the block removed in the previous patch while keeping the SSR
  cold-start smoke test.

- 520d641: Add a signed, content-only recap PNG image route so the PR visual-recap GitHub
  Action can inline a recap screenshot into a (private-repo) PR comment.
  - `POST /_agent-native/recap-image` stores a PNG (raw `image/png` bytes or JSON
    `{ pngBase64 }`, capped at ~5 MB) and returns
    `{ imageUrl: "<origin>/_agent-native/recap-image/<token>.png" }`. It
    authenticates with the SAME `agent-native connect` bearer token the MCP /
    action surface accepts (legacy `sessions` bearer or a connect-minted MCP
    OAuth access token, audience-bound to this app's MCP resource via the
    canonical `verifyAuth`), plus normal browser session cookies. Unauthenticated
    callers get a 401.
  - `GET /_agent-native/recap-image/<token>.png` serves the opaque bytes
    anonymously (so GitHub's camo image proxy can fetch them) with a strict
    `Content-Type: image/png` and a long immutable cache header. Tokens are 32+
    hex chars (no directory traversal); unknown tokens 404. The interactive plan
    stays login-gated.

  Storage is a new additive, dialect-agnostic `recap_images` table created via
  `CREATE TABLE IF NOT EXISTS` (PNG kept as base64 TEXT for portability across
  SQLite / Neon-Postgres / libSQL / D1). Stored images are pruned on write past a
  30-day TTL so the table and the set of anonymously-fetchable image URLs stay
  bounded.

## 0.40.2

### Patch Changes

- 8ea7f6d: Remove the annotated-code dev-doc block from Plans/Content (block source,
  client/server registries, schema, slash menu, and skill guidance).

## 0.40.1

### Patch Changes

- 38dff5b: Fix production 502s on SSR apps (docs, slides, content, assets) caused by the
  browser-only Excalidraw/Mermaid renderers leaking into the Nitro server bundle.
  Nitro re-bundles the server from node_modules and Rolldown merged
  `@excalidraw/excalidraw` into a shared vendor chunk that the SSR render path
  (tiptap, radix-ui, recharts) imported statically, so its top-level `window`
  access ran at function cold-start and crashed every request with
  `ReferenceError: window is not defined`. The Vite SSR build already stubbed these
  libs for `build/server`, but that plugin didn't run during Nitro's separate
  bundle. The deploy build now mirrors the same stub as a Rolldown plugin, replacing
  `@excalidraw/excalidraw`, `@excalidraw/mermaid-to-excalidraw`, and `mermaid` with
  an inert proxy in the server bundle (they only ever render client-side).

## 0.40.0

### Minor Changes

- 2ce5471: Add a reusable `columns` container block for side-by-side (before/after) layouts in visual plans.
- 2ce5471: Promote `/visual-recap` into the Agent-Native Plans skill bundle with CLI
  installer aliases and synced skill copies.

### Patch Changes

- 2ce5471: Scope block edit hover to the directly hovered block and keep generated API reference blocks in a single-column document flow.
- 2ce5471: Expose block metadata to host edit popover renderers so apps can provide
  contextual block-level AI edit actions.
- 2ce5471: Harden shared block renderers against malformed legacy JSON edits, oversized diff inputs, and JsonExplorer expand-state updates.
- 2ce5471: Bound the Neon pooled-connection acquire with a timeout, not just the query. A cold or exhausted Neon pooler can stall on `pool.connect()`, which happens before the query-level `withDbTimeout` can fire — so authenticated requests (which run a session/org lookup on every navigation via `getSession` → `backfillSessionOrg`) hung until the platform killed the function, surfacing as "the app won't load" with lists, org switcher, and team pages stuck loading. The acquire now races the same `DB_OP_TIMEOUT_MS` budget and degrades into a retryable `CONNECT_TIMEOUT`, releasing the connection if it resolves after the timeout so the pool slot isn't leaked.
- 2ce5471: Improve visual plan canvas source formatting guidance and document targeted diagram HTML patching.
- 2ce5471: Highlight code-tab block editors while preserving textarea editing, and infer
  syntax languages from file-like tab labels such as `content.ts`.
- 2ce5471: Limit diff blocks to 15 visible lines by default with a slimmer inline expand
  control, quieter file metadata, and hover-revealed layout controls.
- 2ce5471: Compact single-child folder chains in FileTree blocks, cap the default visible tree rows, and use muted folder icons.
- 2ce5471: Use standard UI label typography for FileTree block paths instead of monospace file text.
- 2ce5471: Fix `zodDefToJsonSchema` to handle Zod v4 `"pipe"` type produced by `z.preprocess()`, `.superRefine()`, and `.transform()`. Previously these fell through to the `{ type: "string" }` fallback, causing action parameters whose schemas use `z.preprocess` (such as `content` in `create-visual-plan`) to be registered as strings in the MCP tool schema. Claude Code and other MCP clients would then JSON-encode object values as strings before sending, breaking validation.
- 2ce5471: Keep shared block tab rails on one horizontally scrollable row when many tabs are present.
- 2ce5471: Improve registry block editing with panel artifacts, inline table editing,
  container edit surfaces, and a drag-handle block action menu.
- 2ce5471: Default JSON explorer blocks to two auto-expanded container levels and add auto-expand presets to the edit popover.
- 2ce5471: Fix Mermaid block runtime loading so Vite rewrites the browser-only Mermaid and
  Excalidraw imports instead of leaving unresolved bare module specifiers in the
  browser.
- 2ce5471: Single-source the shared plan-skill cores (wireframe/canvas/document/exemplar) and share one wireframe-quality core across /visual-plan, /ui-plan, and /visual-recap. The wireframe-quality bar is now identical for forward plans and recaps, and the before/after layout rule is stated once (pick columns vs. vertical stack by geometry), removing the prior /visual-recap contradiction.
- 2ce5471: Keep the full structured block library discoverable in Plans and Content slash
  menus outside Notion-sync mode, including Mermaid, Swagger-style endpoints,
  OpenAPI specs, schema/data models, diffs, file trees, JSON explorers, and
  annotated code. Also let shareable resources normalize access context so local
  Plan ownership stays consistent across generic sharing actions.
- 2ce5471: Polish structured block slash menus with compact descriptions, hidden search
  keywords, one-line ellipsized rows, and keyboard navigation that keeps the active
  item visible while scrolling.
- 2ce5471: Soften the active tab background for shared tabs blocks.
- 2ce5471: Reduce table editing chrome by scoping row and column remove controls to the
  hovered row or header, remove the footer padding control, and edit table text
  through inline rich-markdown cells.
- 2ce5471: Add an optional vertical orientation for the reusable tabs block.
- 2ce5471: Stop generated visual recap plans from adding boilerplate disclaimer and provenance prose blocks.
- 2ce5471: Clarify that visual recaps for UI changes should include wireframes, with before/after used when it helps review the change.

## 0.39.2

### Patch Changes

- fa107db: Clarify generated app guidance so normal app data is action-first, and keep shared framework skills synchronized across generated workspaces and first-party templates.
- fa107db: Fix deploy-time action route discovery so worker/edge builds mount actions with their declared HTTP method and `http.path`.

  The deploy scan previously detected only `method: "GET"` via a plain source-text `includes`, so actions declaring `PUT`/`PATCH`/`DELETE`/`OPTIONS` were silently registered as `POST` (`app.on("POST", …)`) in deployed builds — a method mismatch against the client's actual request that 404s on edge/worker hosts (affected `calendar`'s `update-external-calendars`/`update-overlay-people` PUTs and `brain`'s `delete-source` DELETE). The same naive scan could also be tripped by an unrelated `method: "GET"` elsewhere in the file (e.g. a `fetch(…, { method: "GET" })` in the action body), and it dropped `http.path` entirely.

  Discovery now parses the `http` config block specifically (all verbs, `http.path`, whitespace-tolerant `http: false`), and the generated worker mounts each action at `${prefix}/${http.path ?? name}` — matching the runtime mount in `action-routes.ts`.

- fa107db: Guide architecture and code visual plans toward flexible inline HTML/SVG
  document diagrams instead of top-level UI canvases, custom HTML escapes, or
  default linear node flows.
- fa107db: Expose auth provider profile images on client sessions and seed Google profile pictures into the shared avatar store.
- fa107db: Fold existing-plan import guidance into `/visual-plan` and stop distributing the separate `/visualize-plan` skill.

## 0.39.1

### Patch Changes

- 24a3a14: Add `/plan-design` to the built-in Plans skill bundle and CLI aliases.

## 0.39.0

### Minor Changes

- d82d5f7: Add a "panel" edit surface for config-driven blocks. A block spec can set
  `editSurface: "panel"` (the default when it ships no custom `Edit`) to render its
  `Read` view with a hover corner edit button that opens its editor — the custom
  `Edit` or the schema-driven auto-form — in an app-provided panel
  (`ctx.renderEditSurface`, e.g. a popover), instead of always-inline fields.
  Direct-manipulation blocks (prose, checklist, table, tabs) stay inline. The core
  `custom-html` block opts into the panel.

  Also completes the schema auto-editor (`SchemaBlockEditor`): array fields now
  render as add/remove repeating rows (object elements → nested field groups,
  scalar elements → per-item inputs) and object fields render as nested fieldsets,
  instead of falling back to a "needs custom Edit" hint.

- d82d5f7: Move the eight "dev-doc" structured blocks into the core block library so any app can register them, mirroring how `checklist` / `code-tabs` / `html` / `table` / `tabs` already live in core.
  - **New shared blocks** — `mermaid` (hand-drawn Mermaid diagram), `api-endpoint` (Swagger / Stripe-style endpoint reference), `openapi-spec` (whole-document OpenAPI / Swagger reference), `data-model` (interactive dbdiagram-style ERD), `diff` (GitHub-style before/after with unified + split views), `file-tree` (VS Code / GitHub explorer with change badges), `json-explorer` (collapsible devtools JSON tree), and `annotated-code` (Stripe-docs "explain this code" walkthrough). Their React-free schema + MDX round-trip config export from `@agent-native/core/blocks/server`; their `Read` / `Edit` React renderers export from `@agent-native/core/blocks`.
  - **App-agnostic** — the renderers no longer depend on a host app's shadcn/ui components or `next-themes`. Form controls use minimal inline primitives styled with the same Tailwind tokens, dark mode is detected from the document root's `.dark` class, and the diff line-differ is inlined so core carries no extra runtime dependency. Rendered output (dark/light, collapse, FK-highlight interactivity, panel editing) is unchanged.

- d82d5f7: Export shared registry-block Tiptap node utilities so app editors can render registered block specs through a common NodeView, side-map provider, and duplicate-id reminting plugin.
- d82d5f7: Add single-document editor primitives to the shared rich-markdown editor so the
  plan app can render its whole document as one editable Notion-style ProseMirror
  doc (custom blocks as inline NodeViews) while keeping its `blocks[]` format:
  `gfmToProseJSON`/`proseJSONToGfm` (GFM↔ProseMirror via a headless editor), a
  `RunId` extension (stable per-block prose ids), the shared `DragHandle` extension
  (block grip + drag-reorder, moved from the content app and parameterized via
  `wrapperSelector`), and serializer-injection props on `SharedRichEditor`
  (`getMarkdown`/`setContent`/`normalizeValue`/`shouldSeed`/`wrapperClassName`).

  The `DragHandle` grip now attaches lazily on first hover (re-homing to the
  wrapper once it exists) instead of only at plugin init, so the grip reliably
  appears even when the editor DOM mounts into its wrapper after the ProseMirror
  view is constructed (the React mount order in `SharedRichEditor`).

### Patch Changes

- d82d5f7: Expose shared library block spec registration for template editors.
- d82d5f7: Add a `notionCompatible` block-spec flag and registry helper so apps can derive Notion-sync block allowlists from registered block metadata.
- d82d5f7: Add a shared registry-block slash-command builder for template editors.
- d82d5f7: Fix rich-text editing data loss in the shared collab reconcile. The reconcile now
  remembers a small bounded ring of recent local emissions, so a stale-but-recent
  poll echo — e.g. a debounced autosave that persisted only a partial burst, then
  re-supplied by the next poll with a newer timestamp — can no longer clobber the
  freshly-typed tail. Previously only the single latest emission was recognized as
  an echo, so the trailing characters typed during the save→poll window were
  reverted. External (agent/peer) edits never byte-match a local emission, so
  agent resync is unaffected.
- d82d5f7: Make the unified editor's block library "add a block in ONE place" by sharing the two pieces that were still duplicated between the plan and content editors.
  - **`buildRegistryBlockSlashItems(registry, options)`** (exported from `@agent-native/core/client`) — the shared builder for the registry-derived block slash commands both editors offer. It owns the `registry.list("block")` source, the Notion-compatibility filter, and the one-item-per-spec mapping; each app injects only the parts that legitimately differ (its item shape, its Notion-compat predicate, and how it inserts the block node). Plan's `buildPlanSlashCommands` and content's `buildRegistrySlashItems` are now thin adapters over it.
  - **`registerLibraryBlocks(registry, { overrides? })` + `libraryBlockSpecs`** (from `@agent-native/core/blocks`) — register the whole standard browser library (checklist, table, code-tabs, html, tabs + the eight dev-doc blocks: mermaid, api-endpoint, openapi-spec, data-model, diff, file-tree, json-explorer, annotated-code) in one call. Apps register it, then add only their app-specific blocks on top, passing small per-block `overrides` (e.g. content re-types `table` → `table-block`).
  - **`registerLibraryBlockConfigs(registry, { overrides? })` + `libraryBlockConfigs`** (from `@agent-native/core/blocks/server`) — the React-free twin for server / shared registries, registering the same library as `Read: () => null` config stubs so the agent schema export and MDX round-trip share one source too.

  Adding a 14th standard library block now means editing one core list instead of four app files. The set of registered blocks and the Notion-gating behavior in each app are unchanged.

- d82d5f7: Update bundled Visual Plans skill guidance to use bottom Open Questions form blocks.

## 0.38.0

### Minor Changes

- 5f51768: Give actions and skills tighter control over what the agent sees, and make the clarifying-question UI a first-class building block.
  - **`agentTool: false` on `defineAction`** — expose an action to the frontend / HTTP (`useActionMutation`, `callAction`, `/_agent-native/actions/<name>`) while hiding it from every agent tool surface (in-app assistant, MCP, A2A, job/trigger runners). Frontend/programmatic actions no longer have to spend a slot in the model's tool list. Distinct from `toolCallable`, which only governs the sandboxed extension iframe bridge.
  - **`ask-question` / `askUserQuestion()`** — the built-in clarifying-question tool now accepts a short `header` chip and per-option `preview` content, aligning with Claude Code's `AskUserQuestion`. A new `askUserQuestion()` client helper (exported from `@agent-native/core/client`) lets app code raise the same inline multiple-choice prompt and `await` the user's selected value(s) — so the UI can gate an action on one quick decision. Documented in `client.md` and the `client-methods` skill.
  - **Skill scoping** — SKILL.md frontmatter now supports `scope: runtime | dev | both` (default `both`). The runtime agent excludes `scope: dev` skills from both the system-prompt skills block and `docs-search`, so development-only skills stay invisible to the running app's agent.
  - **Action-surface guidance + advisory audit** — the `actions` skill and docs now teach keeping the action surface small and orthogonal (prefer one CRUD `update` over per-field actions; reach for the generic query/escape-hatch actions instead of minting read actions). Added `pnpm actions:audit`, an advisory scanner that flags likely UI-dead mutating actions and redundant action clusters (never fails CI).
  - **`run(args, ctx)` context** — an action's `run` now receives an optional second argument with the resolved request identity (`userEmail`, `orgId`) and the invocation source (`caller`: `"tool" | "http" | "frontend" | "cli" | "mcp" | "a2a"`), wired at every dispatch site. Read `ctx.userEmail` / `ctx.caller` instead of calling `getRequestUserEmail()` by hand. Backward compatible (1-arg `run(args)` still valid); `userEmail` is never defaulted to a dev identity.
  - **Client-side `track()`** — analytics tracking now works from the browser. A new `track()` client helper (exported from `@agent-native/core/client`) POSTs to `/_agent-native/track`, which forwards the event to the same registered server-side providers (PostHog/Mixpanel/etc) with server-resolved attribution. No analytics SDK or provider keys ship to the client.

- 510f15d: Add a first-party block registry (`@agent-native/core/blocks`). A `BlockSpec`
  describes one document block end to end — a zod `schema` for its data, an `mdx`
  config for byte-stable MDX round-trip, a `Read` renderer, an optional `Edit`
  (auto-generated from the schema when omitted), and `placement` (top-level
  and/or inline). Apps create a `BlockRegistry`, register their specs, and render
  through `BlockView` inside a `BlockRegistryProvider`.
  - `defineBlock` / `BlockRegistry` / `registerBlocks` — author and register blocks.
  - `BlockRegistryProvider` / `useBlockRegistry` — thread the registry + runtime
    render context (asset resolver, action caller, inline markdown editor) into React.
  - `SchemaBlockEditor` + the `markdown()` zod helper — a schema-driven auto-editor
    that renders shadcn-style controls per field, with `markdown()`-tagged string
    fields editing inline via the app's rich-markdown editor.
  - `serializeSpecBlock` / `parseSpecBlock` + the shared `prop()` encoder and
    estree attribute reader (exported from the React-free
    `@agent-native/core/blocks/server` entry) — registry-driven MDX round-trip that
    reproduces the existing component/attribute encoding for backward compatibility.
  - `describeBlocksForAgent` / `renderBlockVocabularyReference` — generate the
    agent's block vocabulary (per-block JSON schemas and a compact markdown
    reference of types, MDX tags, placement, and key fields) directly from the
    registry so the agent never drifts from what the app can render and serialize.
  - A standard block library (`@agent-native/core/blocks` + the React-free
    `/blocks/server` entry): `checklistBlock`, `tableBlock`, `codeTabsBlock`,
    `htmlBlock`, and `tabsBlock`, each with its pure schema + MDX config so apps
    can register the shared specs (plan registers all of them; tabs is also
    inline-placeable).

  The registry is designed to run alongside existing per-block code: renderers and
  the MDX adapter check the registry first and fall back to legacy paths for
  unregistered block types, so existing documents keep working unchanged.

- 510f15d: Add a standard `tabs` block to the core block library
  (`@agent-native/core/blocks`): a horizontal pill-tab container whose tabs each
  hold their own list of child blocks. It exports `tabsBlock` (the full React
  spec), `TabsBlockReader`/`TabsBlockEditor`, and the React-free
  `tabsSchema`/`tabsMdx` config (from `@agent-native/core/blocks/server`). The MDX
  encoding matches the legacy `<TabsBlock … tabs={[…]} />` form — labels and
  nested child blocks are one JSON `tabs` prop (not nested MDX) — so stored
  documents round-trip byte-compatibly.

  Container blocks render their children through a new optional
  `BlockRenderContext.renderBlock` capability (with a `NestedBlock` shape): the app
  wires it to its own block dispatcher so registered children render via their spec
  and unconverted children fall through the app's legacy path. This is the
  coexistence seam that lets a core container block render app-specific child
  blocks without importing them.

- 510f15d: Syntax-highlight code blocks in the shared rich markdown editor. When an embedder
  enables `features.codeBlock` (Plans today), the editor now uses
  `CodeBlockLowlight` with a curated lowlight grammar set (js/ts/tsx, json, css,
  html, bash, python, yaml, sql, markdown) and a github-dark token theme, instead
  of a plain monospace block. Inline code keeps its own background; block code no
  longer leaks the inline-code background over the dark surface. Apps that ship
  their own code node (Content's NFM editor disables `features.codeBlock`) are
  unaffected.
- 510f15d: Add optional real-time multi-user editing to the shared `RichMarkdownEditor`.

  `RichMarkdownEditor` (and the `createRichMarkdownExtensions` factory) now accept
  optional `ydoc`, `awareness`, and `user` props. When a `ydoc` is supplied the
  editor binds the framework's existing collaboration stack — `Collaboration` over
  the shared `Y.Doc`, plus a `CollaborationCaret` for live cursors when an
  `Awareness` is present — and disables StarterKit's built-in undo/redo so Yjs owns
  history. The lead client (elected via `isReconcileLeadClient`) seeds the empty
  shared doc once from the markdown `value`, `onChange` skips remote-origin
  transactions before serializing, and external markdown is reconciled only by the
  lead client when it is genuinely newer. Markdown (GFM) stays the canonical
  emitted/saved representation — the `Y.Doc` is transient live state and is never
  written into stored content.

  With no `ydoc`, the editor is byte-for-byte the same controlled `value`/`onChange`
  single-user editor as before, so existing embedders are unaffected. This lets a
  template wire per-block collaborative prose editing by pairing the editor with
  `useCollaborativeDoc` and a `createCollabPlugin` mount, reusing the shared collab
  backend instead of reimplementing CRDT sync. New exports:
  `createRichMarkdownExtensions`, `RichMarkdownCollabUser`, and
  `CreateRichMarkdownExtensionsOptions` from `@agent-native/core/client`.

- 510f15d: Add a shared block-level image node to the rich markdown editor core so every
  embedder gets an uploading image block — improve it once, both apps improve.
  - **`features.image` + `onImageUpload`** on `createSharedEditorExtensions` /
    `SharedRichEditor`. When enabled, the editor mounts a block-level image node
    (`@tiptap/extension-image`) that serializes to standard markdown image syntax
    `![alt](src)` for the `gfm` dialect — byte-stable and source-syncable (no
    `<img width>` HTML, so the GFM `html:false` contract and the plan round-trip
    corpus are preserved). The node ships a block-aware markdown serializer so an
    image followed by prose keeps its blank-line separator.
  - **Injectable upload contract** `ImageUploadFn = (file: File) => Promise<{ src;
alt? }>`. A self-contained ProseMirror plugin wires paste-image and
    drag-drop-image to the injected uploader (insert placeholder → upload → patch
    `src`), and `createImageSlashCommand(upload)` adds a `/image` file-picker
    command. With no uploader the block still renders and round-trips pasted image
    URLs / `![](url)` markdown.
  - **`uploadEditorImage`** (exported from `@agent-native/core/client`): the
    default uploader. Reads the File as a data URL and calls the framework
    `upload-image` action, returning the hosted CDN URL — so any consumer gets a
    real uploading image block with no per-app upload code.

  Plans now support inserting images via `/image`, paste, and drag-drop; each
  image autosaves as `![alt](url)` markdown through the existing
  `update-rich-text` path. The Content editor keeps its own richer image block
  (Assets picker, AI alt-text, resize, NFM serialization) unchanged — it leaves
  `features.image` off and injects its own image node, so the two never collide
  and Content's NFM image round-trip stays byte-identical.

- 510f15d: Extract the rich markdown editor into ONE shared, configurable core so the plan
  and content editors can build on a single surface instead of duplicating the
  base Tiptap setup, markdown wiring, collab seed/reconcile logic, and the slash /
  bubble menus.

  New exports from `@agent-native/core/client`:
  - `createSharedEditorExtensions(opts)` — the single extension factory. Assembles
    StarterKit + Placeholder + Link + tasks + tables + a dialect-keyed
    `tiptap-markdown` serializer (`MARKDOWN_DIALECT_CONFIG` for `gfm`/`nfm`), then
    optional Collaboration/CollaborationCaret, then app-injected `extraExtensions`.
    Accepts `{ dialect, preset, placeholder, features, extraExtensions, collab }`,
    plus a `starterKit` override (disable replaced nodes / swap the dropcursor), a
    `markdown` config override, and `features.placeholder` / `features.markdown`
    toggles so an app with a bespoke placeholder resolver or its own serializer
    (Content's NFM converter) can reuse just the StarterKit base + collab wiring.
  - `useCollabReconcile(...)` — the seed / reconcile / lead-client / change-origin
    logic extracted into a reusable hook, so the subtle collab behavior is never
    duplicated again. Returns the `onUpdate` guards (`shouldIgnoreUpdate`,
    `registerEmitted`) plus the `isSettingContent` ref. Accepts `getMarkdown`,
    `setContent`, `normalizeValue`, `shouldSeed`, and `initialAppliedUpdatedAt`
    overrides so a non-`tiptap-markdown` serializer (Content's
    `docToNfm`/`nfmToDoc`/`canonicalizeNfm`, sentinel-`<empty-block/>` seed, and
    stale-Y.Doc-on-open reconcile) round-trips byte-identically through the hook.
  - `SlashCommandMenu` + `DEFAULT_SLASH_COMMANDS` and `BubbleToolbar` +
    `buildDefaultBubbleItems` — the inline menus promoted to standalone,
    extendable components (apps pass their own `items` / `buildItems`).
  - `SharedRichEditor` — the editor component (props: `value`, `onChange`,
    `onBlur`, `contentUpdatedAt`, `editable`, `interactive`, `placeholder`,
    `className`, `editorClassName`, `dialect`, `preset`, `features`,
    `extraExtensions`, `ydoc`, `awareness`, `user`, plus optional `slashItems` /
    `buildBubbleItems` overrides).

  `RichMarkdownEditor` and `createRichMarkdownExtensions` remain exported as
  back-compat aliases over the shared core, preserving today's GFM/plan behavior
  exactly — the round-trip fidelity and collaboration specs stay green and the
  plan editor is unchanged. Content-specific Notion/media/comment/database
  extensions are injected via `extraExtensions`, never forced into the shared
  core.

  Phase 2: the Content (Documents) editor now builds on this same shared core. Its
  `createVisualEditorExtensions` routes through `createSharedEditorExtensions`
  (sharing the StarterKit base + the Collaboration/CollaborationCaret wiring +
  ordering), and its inline collab seed/reconcile/lead-client/`onUpdate`-guard
  logic is replaced by `useCollabReconcile` with Content's NFM serializer injected.
  Content keeps every Notion/media/comment/database/NFM-fidelity behavior as
  `extraExtensions` and its own slash/bubble menus, and its NFM round-trip
  (`docToNfm(nfmToDoc(x)) === x`) stays byte-identical — so plan and content now
  share one editor core.

### Patch Changes

- 510f15d: Show a loading skeleton while the Assets picker iframe is initializing.
- 5f51768: Show `sendToAgentChat({ newTab: true, background: true })` work in RunsTray and ensure hidden background tabs start their queued chat turn without stealing focus.
- 510f15d: Fix a content-corrupting reconcile loop in the shared `useCollabReconcile` hook
  (`RichMarkdownEditor` / `SharedRichEditor` for Plans, and the Content editor that
  reuses the hook with its NFM overrides).

  Two compounding bugs caused a rich-text block to escalate every poll
  (`<h1>…</h1>` → `&lt;h1&gt;…` → `&amp;lt;h1&amp;gt;…` …) and fight active typing:
  - **Trigger:** the default `setContent` passed
    `parseOptions: { preserveWhitespace: "full" }`. In tiptap v3 that routes the
    command through `insertContentAt`, which tiptap-markdown ALSO overrides to
    re-run its markdown parser — double-parsing the already-parsed doc and
    re-emitting it as escaped HTML. So even a clean heading/list/code block came
    back non-idempotent and drifted on every reconcile. The default now hands the
    markdown string straight to tiptap-markdown's `setContent` override (no
    `parseOptions`); the GFM corpus round-trips byte-stably, code-block and
    empty-line whitespace included.
  - **Containment:** the reconcile only skipped re-applying when the editor's raw
    serialization equalled the incoming value, so a NON-idempotent value
    (`serialize(parse(value)) !== value`, e.g. raw HTML stored in a block) was
    re-applied indefinitely. The reconcile now compares by DOC EQUIVALENCE: it
    tracks the raw value it last applied and the editor's serialized output after
    that apply, recognizes both a re-supplied raw value and its own autosaved
    serialized echo as already-applied, and re-checks at apply time. A
    non-idempotent block is now applied AT MOST ONCE and the editor stabilizes
    instead of corrupt-looping. External content is also never applied while the
    user is actively typing.

  The idempotent (normal) path, the lead-client election, the `isChangeOrigin`
  skip, and Content's NFM `getMarkdown`/`setContent`/`normalizeValue`/`shouldSeed`
  overrides are unchanged.

- 5f51768: Honor connect-minted MCP OAuth tokens on the HTTP action surface.

  `agent-native connect` mints an MCP-audience OAuth access token and the local
  Plans publish flow POSTs it (as `Authorization: Bearer`) to the hosted action
  route `/_agent-native/actions/import-visual-plan-source`. That token is bound to
  the app's MCP resource, not the legacy `sessions` table, so `getSession` never
  resolved it on the action surface and `requiresAuth` actions like
  `import-visual-plan-source` returned 401 — breaking `publish-visual-plan`.

  `getSession`'s bearer path now falls back to the MCP surface's canonical
  `verifyAuth` for any `Authorization: Bearer` request, so the action surface
  honors exactly the tokens the MCP endpoint honors: same signature check, same
  audience binding to this app's resource, same connect-token revocation gate. It
  resolves to the same `{ email, orgId }` identity, so ownable-data scoping is
  identical. Cookie/page loads (no bearer header) are unaffected, and tokens bound
  to a different app's audience are still rejected.

- 5f51768: Reduce Sentry noise from expected browser auth/abort and reconnect 404 events, and keep social OG images from failing when the native resvg runtime is unavailable.
- 5f51768: Strengthen generated agent instructions to forbid hardcoded API keys, tokens,
  webhook secrets, credential literals, and private data in source, docs,
  fixtures, prompts, action responses, and generated content.
- 510f15d: Improve the hosted Google sign-in warning for Mail by showing it as a popover with a run-local path.
- 5f51768: Super-easy `/visual-plan` setup: `agent-native skills add visual-plan` now
  installs the skill, registers the Plans MCP connector, AND authenticates it in
  one step (reusing the existing `agent-native connect` OAuth / browser
  device-code flow) so you no longer hit an OAuth wall on the first tool call. Add
  a `--no-connect` flag to skip auth, and in non-interactive shells / CI the auth
  step is skipped and the exact `agent-native connect <url>` command is printed
  instead. The unauthorized MCP response (`401`) now returns an actionable JSON
  body with a human-readable message plus the exact remediation (the
  `agent-native connect <url>` command and the authorize / resource-metadata URLs)
  while keeping the `WWW-Authenticate` header for OAuth-capable clients. Adds a
  public docs quick-start page for Visual Plans.
- 5f51768: Correct the `/visual-plan` setup & authentication docs to match the real model.
  The CLI install (`agent-native skills add visual-plan`) installs the skill,
  registers the hosted Plans MCP connector, AND authenticates it in one step (a
  one-time browser sign-in at setup is intended; `--no-connect` skips it) — it does
  not run "no-login local by default". The no-sign-up experience is the
  browser/guest path: anyone you share with can create and edit a plan as a guest
  and only sign in to save or share, at which point their guest plans are claimed
  into their account. Public/shared plans are viewable by anyone with the link;
  commenting requires an agent-native account. Local mode (offline, plans synced to
  your repo as MDX) is documented as a separate advanced path. Updates the shared
  `PLAN_SETUP_AUTH_MD` block across all Plans skills (`/visual-plan`, `/ui-plan`,
  `/visual-questions`, `/visualize-plan`) and the public Visual Plans docs page,
  including its frontmatter description.
- 510f15d: Keep `/visual-plan` and `/ui-plan` on the host agent's normal planning flow,
  using visual questions only for explicit `/visual-questions` intake.
- 5f51768: Add a shared rich markdown editor for inline plan prose editing.
- 5f51768: Plan editor share + side-chat UX: the agent side chat now offers an inline,
  account-free way to paste an Anthropic or OpenAI API key (progressive
  disclosure next to the existing one-click Builder connect) and makes clear the
  side chat is optional — you can keep editing with your own coding agent. Adds a
  `saveAgentEngineApiKey` client helper for storing a bring-your-own provider key.
- 5f51768: Keep generated workspace skills synced from the repository skill source of truth and guard against drift.

## 0.37.3

### Patch Changes

- 309ad84: Tighten bundled visual plan guidance for non-redundant documents and aligned sketch wireframes.

## 0.37.2

### Patch Changes

- ce7f37c: Expose shared Brand Kit helpers for parsing Figma `.fig` local-copy files.
- ce7f37c: Add the visual-questions Plans skill to the installer and support compact share triggers.

## 0.37.1

### Patch Changes

- 1810b32: Fix skill discovery and resource read guidance for agent-native agents.

## 0.37.0

### Minor Changes

- 5d6ef40: Add `useSemanticNavigationState` and `useAgentRouteState` client helpers for
  consistent semantic navigation app-state sync, tab-scoped navigate command
  consumption, and duplicate command protection.

### Patch Changes

- 5d6ef40: Keep the chat shell from waiting on dynamic prompt suggestions, and show a
  three-row suggestion skeleton in empty chats while context-aware suggestions
  load.
- 5d6ef40: Add a "Plan Discipline" section to the exported Plans skills

  `/visual-plan`, `/ui-plan`, and `/visualize-plan` now lead with plan-mode
  process discipline drawn from best-in-class plan modes: right-size when to plan
  (skip trivial work), research the codebase before drafting, keep planning
  read-only, clarify only decision-changing ambiguity before finalizing (otherwise
  state an assumption and proceed), write specific plans with non-goals and a
  closing verification step, and treat the plan as an explicit approval gate before
  any code is written.

## 0.36.0

### Minor Changes

- f424018: Add the Agent-Native Plans `/ui-plan` exported skill and CLI alias for
  UI-first, high-fidelity visual planning.

### Patch Changes

- f424018: Move the Context X-Ray composer meter into a compact popover trigger.
- f424018: Show humanized running tool-call activity and hide argument previews from collapsed tool-call headers.
- f424018: Stop emitting `X-Frame-Options: DENY` from the global security headers middleware, emit iframe-navigation COEP/CORP headers for cross-origin isolated hosts, and allow trusted app host ancestors for extension iframe documents so agent-native apps can run inside iframe hosts.
- f424018: Reconcile deferred external state updates after local editing becomes inactive so agent changes can appear live without a refresh.
- f424018: Keep streamed assistant text visible across transient chat continuations so tool cards no longer jump ahead of earlier text.

## 0.35.3

### Patch Changes

- 2da75f1: Harden Agent Teams serverless dispatch and visibility: quick non-2xx
  self-dispatch responses now fail the sub-agent instead of leaving a ghost
  running task, and background transcripts/stop controls resolve the active
  chunked run id.
- 2da75f1: Add browser-safe client helpers for reading, writing, setting, and deleting
  application state through the framework transport, plus an imperative
  `callAction` helper for client action calls that do not fit React hooks.
- 2da75f1: Keep hosted template server shells CDN-cacheable by applying the shared SSR SWR
  headers to auth login HTML and always enforcing SSR cache headers on React
  Router shell/data responses.
- 2da75f1: Make the stateless MCP server serverless-safe so remote hosts (Claude Code,
  etc.) can actually complete `tools/call`. Two changes to the Streamable HTTP
  transport: (1) `enableJsonResponse: true` so request/response is returned as
  JSON inside the request lifecycle instead of an SSE event pushed after a
  serverless instance has frozen (which dropped the result and surfaced as
  "session expired"); (2) answer `405` for `GET` so clients don't latch onto a
  standalone server-to-client SSE stream a stateless per-request instance can't keep
  alive ("not connected"). Inline MCP App rendering and direct tool calls now
  work over the hosted connectors.
- 2da75f1: Enhance local context reports with workflow diagnostics and update the built-in
  Plans skill installer metadata.
- 2da75f1: Add observable agent chat context helpers for advanced staged prompt context
  sync while keeping `sendToAgentChat({ message, context, submit })` as the
  primary simple UI handoff API.
- 2da75f1: Harden provider API runtime credential scoping and catalog allowlists from late
  review feedback.
- 2da75f1: Quietly handle local auto-dev-account signup races and expose stable core
  client leaf exports for apps that need to avoid the broad client barrel.
- 2da75f1: Move the agent runs tray out of the agent panel header and into the chat overflow menu.

## 0.35.2

### Patch Changes

- 2dccc2a: Exclude `pnpm-lock.yaml` from CLI scaffolding so a freshly created app does not ship a stale lockfile copied from the source template.

## 0.35.1

### Patch Changes

- 56888a3: Update React Router dependencies to 7.16.0.

## 0.35.0

### Minor Changes

- 4740d41: Add a local Context X-Ray skill installer that writes a turnkey context-xray
  command, Codex/Claude skill instructions, and slash-command prompts for
  visualizing local coding-agent context usage.

  Project-scoped installs now stay in project `.agents` artifacts, Codex session
  analysis honors `--project`, `--open` uses a local HTML file instead of a
  detached server, and Windows installs get a native command launcher.

- 4740d41: Add Context X-Ray for inspecting and managing the agent context window with
  segment manifests, pin/evict/restore actions, durable directives, and a chat
  composer cockpit.

## 0.34.0

### Minor Changes

- 1acd641: Add a shared provider API runtime for flexible, provider-aware authenticated HTTP requests, and expose provider API catalog/docs/request actions from Dispatch.

## 0.33.0

### Minor Changes

- 8509cf0: Add a shared `@agent-native/core/provider-api` module: a reusable provider-API runtime with a credential-resolver hook, SSRF-safe outbound dispatch, a provider catalog (base URLs, auth styles, credential keys, docs/spec URLs, placeholders, examples), and helpers (`createProviderApiRuntime`, `getProviderApiConfig`, `isProviderApiId`, `listProviderApiCatalog`, `listProviderApiIdsForTemplateUse`, `PROVIDER_API_IDS`). Templates can build a thin credential adapter on top instead of hardcoding each provider endpoint.

## 0.32.18

### Patch Changes

- 2876933: Clarify Agent Teams delegation intent and distinguish spawned background tasks from completed work.

## 0.32.17

### Patch Changes

- 966838d: Propagate agent team parent thread metadata through background runs.
- 966838d: Expose the Contracts template in public metadata with its dedicated icon alias.
- 966838d: Stop a dropped Neon connection from crashing the whole serverless function. `@neondatabase/serverless` mirrors `pg-pool`, which removes its idle `error` listener while a client is checked out — so a WebSocket that drops mid-query (Lambda freeze/thaw, Neon "terminating connection due to administrator command", an idle socket the pooler closed) made the client emit an `error` event with no listener, which Node escalated to an uncaught exception that killed the function. This was the single highest-volume production crash. `attachNeonPoolErrorLogger` now attaches a persistent `error` listener to every client at connect time (covering all three pools — app, per-app, and Better Auth), so a dropped connection degrades to a logged warning and a reconnect on the next query instead of a process crash.

## 0.32.16

### Patch Changes

- c8773be: Fix social preview response handling and harden Agent Teams recovery paths.

## 0.32.15

### Patch Changes

- ba34976: Make repo-root pnpm dev use the lazy framework gateway by default.

## 0.32.14

### Patch Changes

- 6dde14d: Add a keyed agent chat composer context API for staging hidden context before the next prompt is submitted.
- 6dde14d: Agent Teams sub-agents now run reliably on serverless hosts (Netlify/Vercel/AWS Lambda).

  Previously a spawned sub-agent executed as an in-process detached promise from the spawning request. Serverless hosts freeze the function the moment that response flushes, so the sub-agent was suspended mid-run and never completed — yet `spawn` had already returned `status: "running"`, which the orchestrator narrated as "done." Background "batch" jobs reported success but produced no output.

  Sub-agents now use the framework's durable enqueue-to-SQL + self-fire-HTTP pattern (the same one A2A async tasks and integration webhooks use): `spawnTask` enqueues the run and self-fires a fresh, HMAC-signed POST to a new `/_agent-native/agent-teams/_process-run` route, which executes the run in its own function invocation with its own timeout budget. Runs longer than one function's wall-clock checkpoint at the soft-timeout boundary and self-fire a continuation chunk (the server-side analog of the main chat's client-driven continuation), folding into one durable assistant message via a stable turn id. An atomic SQL claim makes duplicate dispatches idempotent.

  Status reporting is now truthful and observable: `status`/`read-result`/`list` reconcile against the durable queue (a single completed chunk at a continuation boundary no longer prematurely marks a multi-chunk task done), dropped dispatches are re-fired, and genuinely-stalled runs fail with a real message instead of hanging as "running." The RunsTray now self-heals an owner's in-flight runs on read, so it reflects precise status without waiting on the orchestrator to poll.

  This path is host-agnostic — it works anywhere Nitro deploys (no `waitUntil` dependency) and falls back to localhost self-dispatch in dev. It requires `APP_URL`/`URL`/`DEPLOY_URL`/`BETTER_AUTH_URL` to be set in production/shared deployments so the deployment can reach its own URL (the same requirement async A2A and webhooks already carry).

  Note: the previous best-effort "sub-agent finished" auto-recap on the parent thread (a second in-process run that also never survived serverless) is removed; the orchestrator is instead prompted to read `status`/`read-result`, and the RunsTray surfaces completion.

- 6dde14d: Improve background agent visibility by surfacing recent runs in the agent panel and tracking Agent Teams launches in the shared progress tray.
- 6dde14d: Dedupe the client export and server fold of the same tool-call turn so it no longer renders twice. Now that rebuilt tool-call ids are scoped by run (`${runId}:tc_1`) while the live client stream uses a bare counter (`tc_1`), the two copies of one turn hashed to different thread-merge fingerprints; the render-only `toolCallId` is now stripped before fingerprinting so they match again.
- 6dde14d: Recover the agent panel after assistant-ui React fiber unmount crashes instead of leaving the chat UI stuck behind the reset panel.
- 6dde14d: Stop the agent chat from giving up on the first soft-timeout when a turn hasn't produced visible output yet. A complex first turn can spend the whole ~40s soft-timeout window "thinking" before any text or tool call, which previously surfaced "The agent stopped before finishing" with zero retries. Silent run timeouts now retry through a larger empty-continuation budget (1 → 3) so transient slow starts recover, while the cap still terminates a genuinely stuck turn with a clear message instead of looping forever.
- 6dde14d: Suppress Node 22 web stream close races from Vite dev socket error handling so `agent-native dev` does not crash during startup.
- 6dde14d: Add generated Agent-Native social preview images and default OG image metadata.
- 6dde14d: Prevent folded continuation turns from persisting duplicate assistant-ui tool-call resource keys, sanitize already-saved duplicates, and recover standalone prompt composers if the duplicate-key crash still appears.

## 0.32.13

### Patch Changes

- 5fe265e: Fix file uploads failing with a misleading "needs file storage" error when Builder.io was connected at org scope. The `/_agent-native/file-upload` route (and its status endpoint) now resolve the active org and include `orgId` in the request context, so org-scoped Builder credentials are found during upload.

## 0.32.12

### Patch Changes

- 9dc6a6f: Tighten generated agent instructions to prefer existing actions over duplicate REST wrappers.

## 0.32.11

### Patch Changes

- 4ee09b9: Copy ffmpeg-static into serverless bundles so Clips media transcription fallback can extract audio in production.

## 0.32.10

### Patch Changes

- 408af9c: Keep the Builder connect popup open by falling back to the signed connect URL already rendered in the UI when the click-time status refresh fails.

## 0.32.9

### Patch Changes

- 221efac: Fix skill installation edge cases and Notion sync refresh behavior.

## 0.32.8

### Patch Changes

- 8a946c6: Use `@theme inline` so scoped CSS variables (e.g. `.dark`, subtree overrides) apply to shadcn/Tailwind color utilities at use time.

## 0.32.7

### Patch Changes

- bacf30d: Expose Builder account plan metadata from the connect flow status.

## 0.32.6

### Patch Changes

- 69a857a: Preserve array values in action GET query parameters across client and server runtimes.
- 69a857a: Respect `submit: false` in `sendToAgentChat()` so agent chat bridge messages prefill the composer instead of submitting immediately.
- 69a857a: Normalize bracketed GET action query parameters through Nitro's getQuery fallback so array schemas receive arrays consistently.
- 69a857a: Persist stale run error diagnostics when reaping interrupted agent runs.
- 69a857a: Keep the embedded CLI scoped to dev-frame surfaces and route desktop template dev apps through the frame so hot reloads do not refresh terminal state.

## 0.32.5

### Patch Changes

- d56f689: Merge runtime route-warmup config overrides with the build-time config, and tune smooth streaming commit cadence.

## 0.32.4

### Patch Changes

- 826fc96: Keep auth fallback HTML out of shared CDN caches and vary docs markdown/html responses by Accept.
- 826fc96: Move safe React Router route data and JS warmup into the core client with configurable Vite defaults.

## 0.32.3

### Patch Changes

- 25d6fd6: Add CDN and Netlify durable cache headers to framework SSR and route data responses.
- 25d6fd6: Smooth streamed assistant text in chat, Agent-Native Code, and the coding CLI.

## 0.32.2

### Patch Changes

- 3d46958: Fix desktop app login failing in dev with a CORS error
  (`Access-Control-Allow-Credentials is not "true"`).

  The desktop app logs in with `credentials: "include"`. In dev its origin
  (`http://localhost:1420`) was matched by the embed-frame Vite middleware, which
  answered the CORS preflight with `Access-Control-Allow-Origin` but no
  `Access-Control-Allow-Credentials`. The browser then rejected the credentialed
  login. The middleware now also sends `Access-Control-Allow-Credentials: true`
  for origins allowed to use credentials, matching how production responds.

## 0.32.1

### Patch Changes

- d987847: Keep SSR HTML and React Router data responses CDN-cacheable across auth-looking requests, and publish a default no-op Speculation-Rules header to prevent Cloudflare Speed Brain prefetch refusals from surfacing as 503s.

## 0.32.0

### Minor Changes

- a56d93d: Add a shared `@agent-native/core/brand-kit` module — template-agnostic Brand Kit types and brand-signal extraction, plus a single re-export surface over the existing design-token utilities (URL/GitHub/Tailwind/CSS/code/document extraction). This de-duplicates the design-system/brand logic that the `design` and `slides` templates previously copy-pasted, so it can be reused across design, slides, and assets for on-brand generation.

### Patch Changes

- a56d93d: Fix core client runtime races, restricted sharing read checks, and A2A secret
  sync URL safety.
- a56d93d: Fix a batch of verified bugs found in a deep core bug hunt:
  - **Token usage double-counted on `ai-sdk:*` engines.** The AI SDK translator emitted usage from both `finish-step` (per-step) and `finish` (total), so cost tracking, quotas, and context-budget logic saw ~2× the real tokens. Now usage is emitted only from the terminal `finish`.
  - **Cross-tenant screen remounts.** Agent-initiated `refresh-screen` was emitted deployment-global (no owner), so one user's refresh remounted/refetched every other logged-in user's screen. The poll detector is now per-session and owner-scoped, and reads the newest row deterministically (`ORDER BY`/max instead of arbitrary `rows[0]`).
  - **Recoverable soft-timeout turns turned into dead chats.** A transient `thread_data` save failure during a soft-timeout continuation discarded the stashed `auto_continue` and surfaced a hard error; the client now still resumes.
  - **Extension viewer→owner privilege escalation.** A shared/org extension could re-announce its bridge binding from inside the iframe to escalate from viewer to owner. The binding is now latched to the first (pre-user-content) announcement.
  - **LLM-judge evals saw empty transcripts.** The eval transcript builder matched `tool-call`/`tool-result` event types that are never persisted (real shapes are `tool_start`/`tool_done`), stripping all tool activity from judged runs.
  - **MCP static `ACCESS_TOKEN` compared non-constant-time** — now uses `timingSafeEqual`.
  - **Webhook dedup dropped same-second messages** (Telegram/WhatsApp second-resolution timestamps); dedup now prefers the platform's unique message id.
  - **Agent `web-request` and notification webhooks had weaker SSRF protection** than the extension proxy; both now use the shared DNS/redirect/connect-time safe fetch path.
  - **Google Docs reply dedup didn't survive serverless cold starts** (in-memory `Set`), causing duplicate agent replies; processed reply ids are now persisted in the SQL thread mapping.
  - **`upload-image` buffered the entire remote body before enforcing the 25 MB cap** (OOM risk); it now checks `Content-Length` and streams with an early abort.
  - **`useAgentChatGenerating` ignored `tabId`**, so any finished run cleared the generating state of unrelated chat surfaces; it now filters by the run it started.
  - Plus: trace span matching for concurrent same-named tool calls (FIFO), code-mode toggle rollback on server rejection, awareness-map leak prune, retry-delay abort-listener leak, demo-mode status reading the wrong session field, and `removeThread` calling setState inside a state updater.

- a56d93d: Exclude TSX specs and e2e host fixtures from core package builds, refresh the
  package description, and remove unused compatibility/dead streaming code.
- a56d93d: Remove compiler-verified dead code (unused imports, unused non-exported types,
  and side-effect-free unused locals) across the framework. No behavior or public
  API changes — only declarations the TypeScript compiler proves are unreferenced.
- a56d93d: Avoid noisy startup 404s from optimistic chat tabs and make framework route mounting more reliable in serverless builds.
- a56d93d: Route outbound A2A, Dispatch vault, and scheduling webhook requests through
  SSRF-safe URL fetch paths.
- a56d93d: Apply CDN-friendly SWR caching to public SSR HTML and React Router `.data` responses while preserving authenticated/private cache policies, and keep Vite-hashed client assets immutable across deploy targets.

## 0.31.2

### Patch Changes

- 6e6fce7: Internal cleanup sweep: remove unused imports/variables and tidy code (no behavior change).

## 0.31.1

### Patch Changes

- 853ab71: Escape application-state and resource prefix queries so literal `%` and `_` characters do not over-match keys. Also make core store initialization retry after transient failures instead of caching rejected promises, and keep run SSE polling moving past corrupt persisted events.

  Search and rate-limit LIKE filters now treat user text literally, including chat-thread/debug searches and inbound-email sender matching.

## 0.31.0

### Minor Changes

- d4013f0: Add a shared `@agent-native/core/brand-kit` module — template-agnostic Brand Kit types and brand-signal extraction, plus a single re-export surface over the existing design-token utilities (URL/GitHub/Tailwind/CSS/code/document extraction). This de-duplicates the design-system/brand logic that the `design` and `slides` templates previously copy-pasted, so it can be reused across design, slides, and assets for on-brand generation.

### Patch Changes

- d4013f0: Fix core client runtime races, restricted sharing read checks, and A2A secret
  sync URL safety.
- d4013f0: Fix a batch of verified bugs found in a deep core bug hunt:
  - **Token usage double-counted on `ai-sdk:*` engines.** The AI SDK translator emitted usage from both `finish-step` (per-step) and `finish` (total), so cost tracking, quotas, and context-budget logic saw ~2× the real tokens. Now usage is emitted only from the terminal `finish`.
  - **Cross-tenant screen remounts.** Agent-initiated `refresh-screen` was emitted deployment-global (no owner), so one user's refresh remounted/refetched every other logged-in user's screen. The poll detector is now per-session and owner-scoped, and reads the newest row deterministically (`ORDER BY`/max instead of arbitrary `rows[0]`).
  - **Recoverable soft-timeout turns turned into dead chats.** A transient `thread_data` save failure during a soft-timeout continuation discarded the stashed `auto_continue` and surfaced a hard error; the client now still resumes.
  - **Extension viewer→owner privilege escalation.** A shared/org extension could re-announce its bridge binding from inside the iframe to escalate from viewer to owner. The binding is now latched to the first (pre-user-content) announcement.
  - **LLM-judge evals saw empty transcripts.** The eval transcript builder matched `tool-call`/`tool-result` event types that are never persisted (real shapes are `tool_start`/`tool_done`), stripping all tool activity from judged runs.
  - **MCP static `ACCESS_TOKEN` compared non-constant-time** — now uses `timingSafeEqual`.
  - **Webhook dedup dropped same-second messages** (Telegram/WhatsApp second-resolution timestamps); dedup now prefers the platform's unique message id.
  - **Agent `web-request` and notification webhooks had weaker SSRF protection** than the extension proxy; both now use the shared DNS/redirect/connect-time safe fetch path.
  - **Google Docs reply dedup didn't survive serverless cold starts** (in-memory `Set`), causing duplicate agent replies; processed reply ids are now persisted in the SQL thread mapping.
  - **`upload-image` buffered the entire remote body before enforcing the 25 MB cap** (OOM risk); it now checks `Content-Length` and streams with an early abort.
  - **`useAgentChatGenerating` ignored `tabId`**, so any finished run cleared the generating state of unrelated chat surfaces; it now filters by the run it started.
  - Plus: trace span matching for concurrent same-named tool calls (FIFO), code-mode toggle rollback on server rejection, awareness-map leak prune, retry-delay abort-listener leak, demo-mode status reading the wrong session field, and `removeThread` calling setState inside a state updater.

- d4013f0: Exclude TSX specs and e2e host fixtures from core package builds, refresh the
  package description, and remove unused compatibility/dead streaming code.
- d4013f0: Remove compiler-verified dead code (unused imports, unused non-exported types,
  and side-effect-free unused locals) across the framework. No behavior or public
  API changes — only declarations the TypeScript compiler proves are unreferenced.
- d4013f0: Route outbound A2A, Dispatch vault, and scheduling webhook requests through
  SSRF-safe URL fetch paths.

## 0.30.6

### Patch Changes

- 3107f96: Preserve MCP tool error and read-only metadata through action execution, and allow Pinpoint's empty test suite to pass intentionally.

## 0.30.5

### Patch Changes

- 4048de7: Align app-backed skill installs with user-scope requests, keep full JSON install output machine-readable, and let Connect/device-code flows mint standard MCP OAuth tokens with full-catalog coding-agent configs when A2A_SECRET is absent or blank.
- 4048de7: Design exploration now works cleanly from link-only coding agents (Codex, Claude Code CLI, Claude Desktop Code tab): after the user picks a direction in the browser, the editor shows a copyable summary to paste back into chat — matching the Assets picker's standalone handoff. `present-design-variants` now accepts 2–5 directions (3 is the sweet spot) instead of erroring on anything but exactly 3, and its result includes `fallbackInstructions` for the browser path. Docs walk the full install → generate → pick (inline vs link) → apply-to-code flow for both Assets and Design, with the exact paste-back summaries and an install-alias matrix.

## 0.30.4

### Patch Changes

- 2cb6219: CLI + Builder connect: support custom / tunnel origins for local dev.
  - `agent-native skills add` gains a `--mcp-url <url>` flag to register the
    app-backed MCP connector against a custom origin — an ngrok tunnel, a local
    dev server, or a self-hosted deployment — instead of the built-in hosted
    default. A bare origin gets the standard `/_agent-native/mcp` path appended.
  - Fix the "Connect Builder" cli-auth callback when the app is reached via a
    tunnel (e.g. ngrok) whose origin Builder's `/cli-auth` does not trust:
    instead of handing Builder the rejected origin — which makes Builder fall
    back to its own dead `http://localhost:10110/auth` (ERR_CONNECTION_REFUSED) —
    fall back to the app's own `http://localhost:<PORT>` in local dev, an origin
    Builder accepts and a same-machine browser can reach. Production origins
    (`*.agent-native.com`) pass the allow-list and are unaffected.

## 0.30.3

### Patch Changes

- 5eece85: CLI + Builder connect: support custom / tunnel origins for local dev.
  - `agent-native skills add` gains a `--mcp-url <url>` flag to register the
    app-backed MCP connector against a custom origin — an ngrok tunnel, a local
    dev server, or a self-hosted deployment — instead of the built-in hosted
    default. A bare origin gets the standard `/_agent-native/mcp` path appended.
  - Fix the "Connect Builder" cli-auth callback when the app is reached via a
    tunnel (e.g. ngrok) whose origin Builder's `/cli-auth` does not trust:
    instead of handing Builder the rejected origin — which makes Builder fall
    back to its own dead `http://localhost:10110/auth` (ERR_CONNECTION_REFUSED) —
    fall back to the app's own `http://localhost:<PORT>` in local dev, an origin
    Builder accepts and a same-machine browser can reach. Production origins
    (`*.agent-native.com`) pass the allow-list and are unaffected.

## 0.30.2

### Patch Changes

- bf5ba4c: Design exploration now works cleanly from link-only coding agents (Codex, Claude Code CLI, Claude Desktop Code tab): after the user picks a direction in the browser, the editor shows a copyable summary to paste back into chat — matching the Assets picker's standalone handoff. `present-design-variants` now accepts 2–5 directions (3 is the sweet spot) instead of erroring on anything but exactly 3, and its result includes `fallbackInstructions` for the browser path. Docs walk the full install → generate → pick (inline vs link) → apply-to-code flow for both Assets and Design, with the exact paste-back summaries and an install-alias matrix.

## 0.30.1

### Patch Changes

- 221bb55: Refine the app and code agent prompts toward Anthropic/Claude best practices: convert the extension-vs-Builder routing from a prose if/else tree into a scannable `<routing>` heuristic table, reframe the act-mode handoff and dev-mode capability blocks affirmatively instead of as stacked "do NOT" walls, require the code agent to show verification evidence (the command it ran and its key result) rather than asserting success, and soften the emphasis density in the connect-builder tool description.

## 0.30.0

### Minor Changes

- 8a1ff15: Bring the agent + coding harness toward Codex/Claude-Code parity: gpt-5.5-style behavioral core shared across the app and code agents (persona, engineering judgment, autonomy, verify-before-done, communication/final-answer discipline, parallel tool calls), rewritten sub-agent orchestration guidance, a new core ask-question clarifying-question tool with multiple-choice UI (the client now reads the per-tab application-state key so the question card actually renders), enriched coding tool descriptions, refreshed skills, a new writing-agent-instructions guide + docs page, and analytics workflow-discipline instruction improvements.

## 0.29.0

### Minor Changes

- d52e595: Bring the agent + coding harness toward Codex/Claude-Code parity: gpt-5.5-style behavioral core shared across the app and code agents (persona, engineering judgment, autonomy, verify-before-done, communication/final-answer discipline, parallel tool calls), rewritten sub-agent orchestration guidance, a new core ask-question clarifying-question tool with multiple-choice UI, enriched coding tool descriptions, refreshed skills, a new writing-agent-instructions guide + docs page, and analytics workflow-discipline instruction improvements.

## 0.28.5

### Patch Changes

- d3cadf3: Clarify Assets skill instructions for standalone picker handoff fallback.

## 0.28.4

### Patch Changes

- 6ed5aab: Forward structured MCP app host context so external hosts can use selected assets from embedded apps.

## 0.28.3

### Patch Changes

- f29459d: Clean the temporary auth redirect cache-busting query parameter from browser history after client boot.
- f29459d: Database admin: make the agent's db-admin tools available whenever the DB admin
  itself is (`NODE_ENV === "development"`), instead of only when the agent
  Code-mode toggle is on. This gives true agent/UI parity — the agent can read and
  edit the full database through `db-admin-*` tools in App mode too — and the tool
  descriptions now steer the agent to prefer them over the scoped `db-exec`/
  `db-query` for admin work and for tables without `owner_email`/`org_id` scoping.

## 0.28.2

### Patch Changes

- 19e7008: Clean the temporary auth redirect cache-busting query parameter from browser history after client boot.

## 0.28.1

### Patch Changes

- 704305f: Improve MCP app embedding for external hosts by keeping local embed origins usable, avoiding embed params on dev runtime modules, compacting cached app shells, and acknowledging nested chat handoffs so picked assets can round-trip back to the host.

## 0.28.0

### Minor Changes

- 5000a0b: Rename the agent-capability "dev mode" to "Code mode" for clarity. This is the
  toggle that lets the agent run shell/file/raw-DB tools and edit the app's own
  source code — now named distinctly from environment dev mode (`NODE_ENV` /
  Vite).
  - `useCodeMode()` is now the primary client hook, returning `{ isCodeMode,
canToggle, isLoading, setCodeMode }`.
  - `useDevMode()` is kept as a `@deprecated` alias that returns the old
    `{ isDevMode, canToggle, isLoading, setDevMode }` shape, delegating to the
    same shared internal state so existing callers keep working.
  - Back-compat is fully preserved: the `AGENT_MODE` env var, the
    `/_agent-native/agent-chat/mode` endpoint (its payload still uses `devMode`),
    and the `agent-chat.mode` settings key are unchanged. The `/mode` GET response
    now additively includes a `codeMode` field mirroring `devMode`.

### Patch Changes

- 5000a0b: Keep live agent activity steps pinned above the composer while a chat run is in progress, leaving completed activity trails collapsed in the transcript.

## 0.27.0

### Minor Changes

- c3852e0: Add a development-mode database admin: visually browse schemas and tables, view/filter/sort/edit data in a spreadsheet-style grid, and run SQL — with full agent/UI parity. Gated to development mode on localhost.

### Patch Changes

- c3852e0: Security hardening for the agent's raw-SQL tools, cross-tenant run isolation,
  server-side SSRF, and CSRF:
  - **db-query / db-exec scope bypass (cross-tenant read/write):** schema-qualified
    table references (`public.<table>` on Postgres, `main.<table>` on SQLite) now
    fail with a clear error, since a qualified name bypasses the per-user/per-org
    temporary views that isolate each tenant's rows. The same guard protects the
    extension SQL surface, which routes through the same tools.
  - **Credential exfiltration via db tools:** per-user credential rows
    (`u:<email>:credential:*`, stored by `resolveCredential`) are now excluded from
    the agent's scoped `settings` view, so a prompt-injected agent can no longer
    read the user's own API keys/tokens through `db-query` and send them out.
  - **Cross-tenant agent run leak + abort:** `GET /runs/:id/events`,
    `GET /runs/active`, and `POST /runs/:id/abort` now verify the caller owns the
    run's thread (404 otherwise), closing a hole where any authenticated tenant who
    learned another tenant's runId/threadId could stream their live agent turn
    (assistant text + tool-result payloads) or abort their run.
  - **Server-side SSRF:** the `upload-image` action and the `import-from-url`
    design-token fetcher now route untrusted URLs through a shared `ssrfSafeFetch`
    (DNS-aware private-address check, connect-time IP guard, per-redirect
    re-validation), so they can no longer be steered to cloud metadata, localhost,
    or internal services.
  - **CSRF:** `Sec-Fetch-Site: same-site` is no longer trusted as first-party, so a
    sibling-subdomain page under a shared cookie domain can't ride the session
    cookie for a state-changing request. Legitimate first-party clients still pass
    via the custom-header / JSON paths; iframe and embed flows are unaffected.

- c3852e0: Beta-readiness best-practices audit fixes:
  - **core / sharing:** `mergeCoreSharingActions` now preserves
    `toolCallable`/`publicAgent`/`link`/`mcpApp` (via `preserveActionFlags`),
    restoring the H5 tools-bridge `403` guard on share/unshare/set-visibility that
    was silently dropped during registry merge.
  - **core / HTTP actions:** stop echoing raw `error.message` on uncategorized 500s
    (return a generic message, log detail server-side); validation and explicit
    user-facing errors still pass through.
  - **core / auth:** remove the legacy hardcoded fallback secret literal from the
    production `BETTER_AUTH_SECRET` error message. (The `better-auth` security
    version bump is deferred to a dedicated follow-up: `1.6.12` pulls
    `kysely@0.29` which drops exports `better-auth` bundles, breaking the template
    build — it needs a kysely-compatibility fix + an auth smoke-test.)
  - **core / dev:** register `client/transcription/use-live-transcription` in the
    Vite source-alias map so monorepo dev edits resolve from source, not stale
    `dist`.
  - **core:** add `engines.node >=22`; correct the `AuthSession.orgId` doc comment
    (orgs are framework-managed, not the Better Auth organization plugin).
  - **scheduling:** remove the leftover manual `release` script (publishing goes
    through changesets/CI).
  - **shared-app-config:** clarify that the template-catalog `icon` field is an
    internal icon-alias key resolved by the desktop sidebar `ICON_MAP`, not a raw
    `@tabler/icons-react` export name.

- c3852e0: Documentation audit and overhaul. Fixed accuracy bugs across the docs content
  (wrong import paths, stale API shapes/examples, incorrect constants and ports),
  de-duplicated overlapping material (MCP embed bridge, Dispatch resource model,
  data-scoping pipeline, CLI run-model, database/deployment adapter details),
  trimmed and normalized the template docs, expanded the Frames page, added a
  "Using Your Agent" overview, reorganized the docs nav (split Architecture into
  Core Architecture and Data/Auth & Governance, moved Onboarding into Workspace),
  and reconciled terminology.
- c3852e0: Encrypt per-user / per-org credentials at rest. `saveCredential` /
  `resolveCredential` previously stored third-party API keys as plaintext in the
  `settings` table; they now AES-256-GCM-encrypt values using the same key
  material as the secrets vault (`SECRETS_ENCRYPTION_KEY` / `BETTER_AUTH_SECRET`),
  so a leaked DB backup / pg_dump / read replica no longer exposes plaintext keys.
  Reads transparently fall back to legacy plaintext rows, so nothing breaks during
  rollout. A one-shot, idempotent, non-destructive migration
  (`pnpm action db-migrate-encrypt-credentials`) re-encrypts existing rows in
  place. The encryption helper is now shared between the secrets vault and
  credentials (`secrets/crypto.ts`); behavior of the vault is unchanged.
- c3852e0: Stop inbound email from impersonating real users. The inbound email adapter now
  derives a `senderVerified` flag from the provider's DKIM/SPF
  (`Authentication-Results`) results, and dispatch only grants a sender's real
  identity — their API keys, org secrets, personal instructions, and ownable data
  — when the message is DKIM/SPF-verified for the From domain AND that address is a
  real org member. Unverified or spoofed `From:` headers fall back to a synthetic,
  credential-less owner. Linked identities (`/link`) are unchanged. The legacy
  "trust the From header" behavior can be restored with
  `DISPATCH_TRUST_UNVERIFIED_EMAIL_SENDER=1` (off by default).

## 0.26.9

### Patch Changes

- 4e7b04a: Add the hosted Design exploration app-backed skill so local agents can install Design MCP instructions and connector setup with `agent-native skills add design-exploration`.

## 0.26.8

### Patch Changes

- 0d72061: Preserve organization identity in remote MCP OAuth access tokens so MCP App
  embed sessions can resolve org-scoped credentials.

## 0.26.7

### Patch Changes

- 0a3003d: Harden MCP app embedding and selected image handoff for Assets picker flows.
- 0a3003d: Improve MCP app embedding and compact Assets picker flows for external chat hosts.

## 0.26.6

### Patch Changes

- fcca046: Retry secret-store table bootstrap after transient database failures and use a
  complete Builder connection check for setup UIs.

## 0.26.5

### Patch Changes

- a6c58a8: Validate Builder private keys before storing them and send the matching public
  key with managed image-generation requests.
- a6c58a8: Serve unauthenticated app HTML as cacheable 200 responses and let the sign-in page perform client-side session redirects.
- a6c58a8: Apply the default public SSR cache policy to React Router `.data` responses
  that only carry React Router's default `no-cache` header.
- a6c58a8: Pin Better Auth in scaffolded workspace roots until the latest Kysely adapter build is compatible.

## 0.26.4

### Patch Changes

- b523050: Tighten MCP app embedding for external hosts, including OAuth discovery, compact app launch behavior, and Claude web transplant support.

## 0.26.3

### Patch Changes

- fc4bdb9: Set year-long immutable cache headers for content-hashed client assets in framework deploy outputs.

## 0.26.2

### Patch Changes

- 1b4800f: Update signup marketing copy to say Agent Native is 100% free and open source.

## 0.26.1

### Patch Changes

- 119397a: Add image-generation aliases for the built-in Assets skill installer.
- 119397a: Expose optional MCP server branding metadata from agent chat plugins and let embedded MCP App hosts open Builder connect links.
- 119397a: Allow Cloudflare quick tunnel hostnames in the default Vite dev server host allowlist.

## 0.26.0

### Minor Changes

- a456cf8: Make the agent a real-time peer editor on collaborative documents. Add `isReconcileLeadClient(awareness, clientId)` so exactly one connected client applies an authoritative external snapshot (agent edit, Notion pull, full rewrite) into a shared Y.Doc — the rest receive it through normal Yjs sync — preventing the changed region from being duplicated across clients. Editors now reconcile newer SQL content into the live Y.Doc gated on `updatedAt`, so a lagging poll can never revert live edits and post-refresh content is always correct.

### Patch Changes

- a456cf8: Harden agent chat continuation across serverless timeouts. Fixes several cases where a turn that hit a timeout would error or stall instead of resuming: (1) a tool still in flight when the timeout fires now counts as progress, so the client no longer gives up in ~2s with "connection kept failing" while the server is actively working; (2) the empty-continuation cap is measured by real content (not bare part count) so whitespace-only output can't mask a stall; (3) large tool inputs (create-extension / update-extension HTML) are preserved verbatim in continuation history instead of degrading to a lossy placeholder, so the agent can keep refining; (4) the run-manager terminal/auto_continue event seq is stamped at emit time so late events can't collide and silently drop the continuation signal.
- a456cf8: Use provider-specific agent output-token caps and continue agent runs after max-token stops.
- a456cf8: Surface inactive Builder access-token gateway errors as reconnectable Builder auth failures.
- a456cf8: Add a reconciled client state hook and further compact agent prompt context.
- a456cf8: Reduce default agent token budgets and trim always-on prompt context for routine requests.

## 0.25.0

### Minor Changes

- ed1502b: Add "Upload Skill" option to the resources create menu so users can import an existing SKILL.md file.

## 0.24.10

### Patch Changes

- fb600a2: Harden agent chat continuation across serverless timeouts. Fixes several cases where a turn that hit a timeout would error or stall instead of resuming: (1) a tool still in flight when the timeout fires now counts as progress, so the client no longer gives up in ~2s with "connection kept failing" while the server is actively working; (2) the empty-continuation cap is measured by real content (not bare part count) so whitespace-only output can't mask a stall; (3) large tool inputs (create-extension / update-extension HTML) are preserved verbatim in continuation history instead of degrading to a lossy placeholder, so the agent can keep refining; (4) the run-manager terminal/auto_continue event seq is stamped at emit time so late events can't collide and silently drop the continuation signal.

## 0.24.9

### Patch Changes

- 5ae4924: Cap the per-message `<current-screen>` context so a large `view-screen` snapshot (e.g. a recording/meeting page returning a full transcript + every segment) can no longer overflow the model context window and hard-error the chat with `context_length_exceeded`. The screen snapshot injected into every user message is now bounded to ~24K chars with a note pointing the agent at `view-screen` / data actions for full detail. This fixes brand-new chats failing on the first message and the very high time-to-first-token caused by an oversized ambient context.

## 0.24.8

### Patch Changes

- aa80e15: Clamp hosted run soft timeouts below upstream hard walls and surface Anthropic tool input progress.
- aa80e15: Add shared default social image metadata helpers and SSR injection.
- aa80e15: Update the open source badge copy to mention Agent Native is 100% free and open source.
- aa80e15: Keep the chat composer scrolled to the caret when inserting Shift+Enter line breaks.
- aa80e15: Recover client API paths from the live workspace mount when a stale app base path points at another workspace app.
- aa80e15: Stop losing agent chat turns that span a serverless timeout. A turn that is cut off mid-stream (the Builder gateway's 45s wall or the function/heartbeat limit) and resumed via auto-continuation now folds every continuation run onto a single durable assistant message keyed by a stable `turnId`, instead of each run persisting only its own events and dropping the earlier text. This fixes the "the agent stopped, then the last paragraphs disappear and it says it's just getting started" failure: the streamed text and completed tool calls are preserved in `thread_data` (monotonic, never-shrinking) so reloads and follow-up turns keep full context. Errored/cut-off runs are also now classified (`error_code`/`error_detail`) and retained longer than completed runs so failure patterns can be analyzed.
- aa80e15: Inject the default Agent-Native social image into SSR HTML when templates do not provide an OG image.
- aa80e15: Harden workspace scaffold test cleanup against transient filesystem races.

## 0.24.7

### Patch Changes

- 5355ff0: Keep the optional undici import out of browser and template build graphs.

## 0.24.6

### Patch Changes

- 1c28701: Allow extension key resolution to fall back to scoped app credentials after vault secrets miss.

## 0.24.5

### Patch Changes

- 32bb63c: Remove browser-facing ACCESS_TOKEN auth gates and keep static bearer tokens limited to MCP/connect fallback clients.

## 0.24.4

### Patch Changes

- 4b91db4: Block raw database tools from writing app-defined identity and access-control data.

## 0.24.3

### Patch Changes

- daeb0a9: Add custom migration plan inputs for AEM, Builder, headless, jQuery, and verification planning.
- daeb0a9: Harden chat thread pin and archive updates with owner checks and client rollback on failure.

## 0.24.2

### Patch Changes

- ff0fae2: Allow Brain and Dispatch sidebar chat threads to be renamed from their row menu.
- ff0fae2: Add fresh-start chat surfaces plus chat thread pin/archive metadata.
- ff0fae2: Generalize the onboarding copy for image generation provider key setup.
- ff0fae2: Keep framework routes registered through the H3 shim visible to Nitro 3 generated server dispatchers.
- ff0fae2: Promote Brain and Assets in public template catalogs and Dispatch workspace template defaults.
- ff0fae2: Render workspace app menu links with the same template icons used by the desktop app.

## 0.24.1

### Patch Changes

- 7aa1703: fix builder connect 401 for unauthenticated users with a valid connect token

## 0.24.0

### Minor Changes

- 9f3a798: Add extension history snapshots, diffs, and restore support.

### Patch Changes

- 9f3a798: Return 401 for unauthenticated private page routes while still rendering the sign-in page.
- 9f3a798: Recover agent chat runs that time out while preparing extension action input.
- 9f3a798: Keep chat recovery retries anchored to the original user request and give hosted timeout recovery more room to persist.
- 9f3a798: Preserve generated chat titles when later thread saves update chat metadata.
- 9f3a798: Keep lazy gateway wake pages active until app dev servers return HTTP responses.

## 0.23.0

### Minor Changes

- 2ea399e: Add app-backed skill packaging and CLI support for hosted/local app skill installs.

### Patch Changes

- 2ea399e: Rename the Images template/package to Assets, preserve legacy aliases, and add DAM/video generation capabilities.
- 2ea399e: Add chat-surface controls for hidden thread tabs and centered empty composers.
- 2ea399e: Clarify deployment, scaffold, skill, and template guidance for persistent databases and provider-agnostic Drizzle code.
- 2ea399e: Expose selected Dispatch workspace skills, resources, and MCP server definitions to granted app agents at runtime.

## 0.22.45

### Patch Changes

- 4bed290: Harden collaborative editing against missed updates and concurrent Yjs persistence races.

## 0.22.44

### Patch Changes

- 7ca6c99: Allow UI-submitted agent chat messages to include image data.

## 0.22.43

### Patch Changes

- bcf54ce: Fix race condition in `useChatThreads` that dropped the active general chat when the user navigated into a scoped resource before `GET /threads` resolved. The scope-flip rehydration effect now defers the decision when thread metadata is unknown (instead of falling through and swapping to the scoped storage key), so the visible conversation is preserved until threads load and a real decision can be made.

## 0.22.42

### Patch Changes

- 5f82202: `open_app({app: "<id>"})` now defaults to the app's home page (`/`) when neither `view` nor `path` is given, instead of throwing `requires 'app' and either 'view' or 'path'`. Hosts (ChatGPT / Claude) previously wasted a turn on the model's first-attempt retry whenever it omitted view/path; this lands the embed on `/` first try.
- 5f82202: Re-export `deleteOrHideExtension` and `hideExtensionForCurrentUser` from `@agent-native/core/client/extensions` so templates that wrap the extensions system (e.g. Workbench Custom Tools) don't have to deep-import internals. Also add CLI templates-meta entry for the new hidden `workbench` template.

## 0.22.41

### Patch Changes

- c790686: Fix MCP App embed regression: `create_embed_session` (and any tool with `_meta.ui.visibility: ["app"]`) now surfaces its raw result via `structuredContent` so the embed iframe can read the mint `startUrl`.

  Without this, PR #875's text-side embed-URL purge stripped the embed start URL from the only fallback the iframe had, breaking the "open inline" flow with "This app can be opened, but not embedded from this MCP server." Compliant hosts already honor the `visibility: ["app"]` hint and keep the tool result out of the LLM transcript; the structuredContent path is safe for these tools.

## 0.22.40

### Patch Changes

- 4a8e279: Route MCP App embed open links through the desktop deep-link handler.

## 0.22.39

### Patch Changes

- 1ed3ef8: Clear MCP app host generate loading state after direct host sends and fall back to the wrapper relay when direct sends fail.

## 0.22.38

### Patch Changes

- 9e22f33: Harden MCP host integration against ticket and content leaks. Strip embed-ticket URLs from any tool result text even when the action does not declare `mcpApp.resource`. Filter `embedTargetPath`, `embedExpiresAt`, and `ticket`-like fields from MCP structured content (their legitimate carrier is `_meta["agent-native/embedStart"]`). Stop fabricating an `_meta["agent-native/openLink"]` `webUrl` from a bare view name like `"deck"` when the action returns only an embed-start URL. Remove the now-unused `compose` field from `buildDeepLink` so deep-link URLs cannot inline draft contents. Make `isEmbedMcpChatBridgeActive` keep the in-memory bridge flag once enrolled so sandboxed iframes that deny sessionStorage no longer silently drop chat-bridge mode mid-session.

## 0.22.37

### Patch Changes

- 12d3c0f: Fix MCP app host catalog and embed metadata edge cases.

## 0.22.36

### Patch Changes

- 1c0b51e: Add ShareButton options for template-specific access labels and top-positioned share links.
- 1c0b51e: Fix MCP app host context clearing, compact catalog compatibility, and embed-only open-link metadata.
- 1c0b51e: Keep general chat threads visible when navigating into scoped resources.
- 1c0b51e: Keep MCP App host catalogs compact by default, hide one-time embed tickets from model-visible output, and keep host follow-up prompts separate from hidden context.
- 1c0b51e: Bust cached MCP App shells so hosts load the refreshed embed wrapper.
- 1c0b51e: Improve ShareButton member autocomplete with server-side org-member search, pagination, and keyboard selection.

## 0.22.35

### Patch Changes

- 6f76cbe: Bust cached MCP App shells so hosts load the refreshed embed wrapper.

## 0.22.34

### Patch Changes

- bc9c866: Recover built-in auth marketing copy from hosted app request context.
- bc9c866: Use branded first-party auth pages when the default auth guard serves before a template plugin.
- bc9c866: Fix MCP Apps metadata and extension-page embeds for Claude and ChatGPT hosts.
- bc9c866: Keep default SSR HTML cache headers public even when requests include auth cookies.

## 0.22.33

### Patch Changes

- d0a107e: Default MCP Apps hosts to the compact generic app catalog instead of listing every action-specific UI resource.
- d0a107e: Refuse to auto-bind CLI actions when multiple dev session owners exist.

## 0.22.32

### Patch Changes

- 5c6b741: Emit MCP App widget domain metadata so ChatGPT can render submitted app templates.

## 0.22.31

### Patch Changes

- 11362a2: Keep MCP App resource listing resilient to CSP metadata failures and invalid Dispatch app URLs.

## 0.22.30

### Patch Changes

- 3b1a0e5: Accept nested `params.embed` and `params.chrome` values in MCP `open_app` calls.

## 0.22.29

### Patch Changes

- a899300: Allow MCP App embed fetches to follow Agent-Native open redirects in Claude.

## 0.22.28

### Patch Changes

- 4a5dc8d: Retry transient agent-chat route-missing startup responses and harden Dispatch MCP embed fallback behavior.

## 0.22.27

### Patch Changes

- 5986cd0: Keep MCP Apps resource CSP and permissions on UI resources instead of tool descriptors.
- 5986cd0: Add a reusable interactive starfield background with subtle cursor attraction.

## 0.22.26

### Patch Changes

- 0efeaec: Allow Dispatch-routed MCP app embeds to authenticate target apps with synced org A2A secrets.

## 0.22.25

### Patch Changes

- b76bf4f: Bust MCP App shell resource caches so host CSP metadata refreshes after embed changes.

## 0.22.24

### Patch Changes

- b275383: Allow MCP app embed wrappers to connect to configured frame domains so Claude can transplant cross-app embeds.

## 0.22.23

### Patch Changes

- 75223dd: Fix Dispatch-routed MCP App embed sessions and surface embed helper errors in the wrapper.
- 75223dd: Expose current extension ids to agents and wait for tracked async framework plugins before dispatching first serverless requests.

## 0.22.22

### Patch Changes

- 1a9d1c0: Mint same-app MCP embed sessions during app launches so Claude can render embedded apps without iframe-originated tool calls.

## 0.22.21

### Patch Changes

- 56e5abc: Use Claude single-frame transplant rendering and ChatGPT controlled route frames for MCP App embeds.

## 0.22.20

### Patch Changes

- 7918065: Default Agent-Native SSR page responses to public cache headers with short max-age, week-long stale-while-revalidate, and hour-long stale-if-error, without creating sessions for anonymous page hits.
- 7918065: Improve MCP App route embeds by using signed real app routes across hosts, preserving host chat bridge state, controlling ChatGPT route height, and mounting the real signed app document inside Claude's proxied MCP content frame.
- 7918065: Make MCP app embeds default to 560px, shrink toward the host-visible height, and cap dynamic resize reports at the configured embed height.

## 0.22.19

### Patch Changes

- 1750384: Make MCP App embeds navigate the host frame into the real app route, keep the MCP chat bridge alive after embed-token redirects, and cache-bust the shared MCP App shell resource.

## 0.22.18

### Patch Changes

- bf1cb24: Expose MCP App CSP metadata, compact unknown OAuth app hosts, support ChatGPT's window.openai bridge, and show a Claude-safe fallback when nested app frames are blocked.

## 0.22.17

### Patch Changes

- 5173662: Add COEP-compatible dev headers for MCP embed page loads.
- 5173662: Emit Cross-Origin-Embedder-Policy for validated MCP embed-session page loads.
- 5173662: Relax Cross-Origin-Resource-Policy for validated MCP embed-session page loads.
- 5173662: Allow MCP app runtime requests to resolve validated embed-session cookies.
- 5173662: Allow MCP App full-app embeds to load in hosted chat clients with stricter iframe and resource policies.
- 5173662: Lower default full-app MCP App embeds to a 720px app viewport.
- 5173662: Allow MCP app embeds to load resources from the request origin.
- 5173662: Prevent same-origin 401/403 responses from causing client retry storms.

## 0.22.16

### Patch Changes

- 6de0eaf: Fix `/assets/*` 404s in production builds. The React Router client build is now
  copied into Nitro's `publicDir` before `nitroBuild` runs, so the static-asset
  manifest baked into the server bundle includes hashed JS/CSS chunks. Previously
  the copy happened after `nitroBuild`, leaving the files on disk but invisible to
  Nitro's runtime `serveStatic` handler — every `/assets/*` request fell through
  to the SSR catch-all, which 404s any path with a file extension.

## 0.22.15

### Patch Changes

- 0ba051e: Relay `sendToAgentChat()` submissions from MCP App embeds to compatible chat hosts.
- 0ba051e: Prevent HEAD probes from consuming one-time MCP app embed tickets before iframe navigation.
- 0ba051e: Add client helpers for MCP App host integration.
- 0ba051e: Add an embedRoute helper that pairs action deep links with MCP App resources.
- 0ba051e: Add a ShareButton hook for hiding organization-link resources from discovery.

## 0.22.14

### Patch Changes

- b09db79: Prevent unavailable optional agent engines from being selected by chat model pickers or explicit runtime overrides.

## 0.22.13

### Patch Changes

- 0b4ade2: Use the official Gemini 3.5 Flash model ID for the Google provider.
- 9482ec9: Harden serverless database pool cleanup and chat thread conflict retries.
- 54f295b: Make MCP App embeds launch real app routes reliably and keep web-host discovery compact.

## 0.22.12

### Patch Changes

- c43d534: Fix MCP App full-app embed launching through open routes and keep app-host discovery compact.

## 0.22.11

### Patch Changes

- e3b219b: Emit compact MCP Apps tool catalogs for OAuth app hosts and include ChatGPT-compatible widget metadata for real app embeds.

## 0.22.10

### Patch Changes

- ce325de: Include chat session context in feedback submissions and harden chat debug clipboard actions.

## 0.22.9

### Patch Changes

- e834a27: Improve MCP App embed startup reliability.

## 0.22.8

### Patch Changes

- bbaa675: Allow MCP App frame CSP sources emitted by the built-in app embed helper so local and HTTPS app frames render correctly, and expose the helper through the browser-safe core entry used by template actions.
- bbaa675: Clarify MCP app embeds can target focused app routes as well as full app surfaces.
- bbaa675: Request taller full-app MCP App embeds.
- bbaa675: Prevent replayed chat history with interrupted tool calls from sending malformed tool-use messages to model gateways.

## 0.22.7

### Patch Changes

- 2fcecb9: Fix `backfillEngineMessagesToolResults` so a `tool-result` is only paired with `tool-call`s from assistant messages that appeared earlier in the conversation. The previous global lookup overwrote earlier entries when ids collided (e.g. reused `continuation_tc_*` ids after adapter recreation), causing older history to be backfilled with the wrong `tool_name` / `tool_input` and sent that way to the Builder LLM gateway.
- 2fcecb9: Include `tool_name` and `tool_input` on every `tool_result` sent to the Builder LLM gateway (Gemini compatibility), backfill from prior `tool_use` when replaying history, add gateway client identification headers, and require `toolName`/`toolInput` on engine tool-result parts. Preserve unmatched structured-history tool results as text (then run `backfillEngineMessagesToolResults`) so replay never drops that payload before backfill runs. `backfillEngineMessagesToolResults` now turns orphan engine `tool-result` parts into the same replay text (instead of silently dropping them), and structured history coerces legacy non-string `toolCallId` / `content` shapes from stored JSON.

## 0.22.6

### Patch Changes

- 789ba7d: Clarify starter app creation guidance, seed app descriptions, and remove starter/new-app leftovers from starter-derived apps.
- 789ba7d: Add Dispatch unified MCP gateway guidance and app-grant controls.
- 789ba7d: Add MCP App full-app embedding with short-lived browser sessions.
- 789ba7d: Ignore test files when discovering and generating runtime action registries.
- 789ba7d: Skip stored AI SDK agent engines when their optional runtime packages are not installed.

## 0.22.5

### Patch Changes

- 7873242: Clear the chat attachment drop overlay when editor-level drops consume the drop event.
- 7873242: Resolve Builder assistant credentials from a single complete user/org/workspace scope so partial personal rows do not hide org-shared connections.
- 7873242: Start fresh chats on new browser/project surfaces instead of auto-opening the latest server thread.
- 7873242: Sanitize resent email verification callback URLs before forwarding to Better Auth.

## 0.22.4

### Patch Changes

- b5fc3b7: `/_agent-native/mcp/connect` now leads with the no-CLI path: the remote MCP URL is shown with a copy button, and a Claude/ChatGPT/Cursor/Claude Code/Codex/Other tab strip walks users through each host (paste-the-URL for OAuth hosts, one-line `claude mcp add` / `npx @agent-native/core@latest connect` snippets for CLI hosts) so non-developers can connect a chat host without ever opening a terminal. The static-token mint flow and connections list keep their existing endpoints; tests cover the new sections.

## 0.22.3

### Patch Changes

- 5a5b620: Isolate local dev auth cookies per app and stop first-party hosted apps from sharing incompatible agent-native.com session cookies.
- 5a5b620: Derive production workspace auth and OAuth signing secrets from A2A_SECRET when explicit auth secrets are not configured.

## 0.22.2

### Patch Changes

- 4a35c70: Preserve MCP Apps metadata during static action discovery and write hosted Codex MCP installs as HTTP server entries.

## 0.22.1

### Patch Changes

- 570923a: Respect the persisted agent chat sidebar state inside Builder frames.
- 570923a: Persist mutating action change markers so child-process actions refresh custom app UIs.

## 0.22.0

### Minor Changes

- 819cf59: Add standard remote MCP OAuth discovery, authorization-code + PKCE, refresh-token rotation, scoped MCP access tokens, and OAuth-native `agent-native connect` config for Claude Code clients.

### Patch Changes

- 819cf59: Improve custom app action sync defaults and starter guidance.
- 819cf59: Honor collapsed agent-sidebar deep links when an already-mounted app receives the URL hint.
- 819cf59: Mount the local agent sidebar before delivering programmatic chat submissions so prompts are not dropped when the sidebar starts closed.
- 819cf59: Address MCP app route hardening and Dispatch vault cleanup edge cases from review.
- 819cf59: Fix dev-mode agent feedback issues around connection-reset overlays, request-scoped shell identity, and assistant markdown rendering.
- 819cf59: Sign Builder connect URLs rendered in chat cards and return gateway callbacks to the preview opener.
- 819cf59: Add granular extension content edits with marker/section operations and optional Prettier formatting.

## 0.21.0

### Minor Changes

- 65d43fd: Add host-side MCP Apps rendering support for connected MCP tools.

### Patch Changes

- 65d43fd: Add `agent-native connect dev` and `agent-native connect prod` for switching first-party MCP entries between hosted apps and local dev-lazy gateways.
- 65d43fd: Add optional MCP Apps UI resources for action tools while preserving deep-link fallbacks.
- 15d9967: Clean up synced Dispatch vault secrets on delete and make DB timeout cleanup awaitable.

## 0.20.9

### Patch Changes

- 482e9db: Make agent chat recovery continue after useful tool progress instead of prematurely surfacing connection failures.
- 482e9db: Add an interactive hosted-app picker when `agent-native connect` is run without a URL, and default connect-minted MCP tokens to a 365-day lifetime.
- 482e9db: Bound every DB init/query op with a timeout (`withDbTimeout`, `DB_OP_TIMEOUT_MS`, default 8s on serverless). A frozen→thawed serverless instance could leave the Neon WebSocket hung mid-query so the promise never settled and never errored — `retryOnConnectionError` only retries thrown errors, so authenticated requests (which run a session lookup on every navigation) hung until the platform killed the function (~30s on Netlify), surfacing as "the site won't load". The timeout reports as a retryable `CONNECT_TIMEOUT`, so the existing retry and reject-reset paths recover and the cached session-table init promise no longer stays poisoned. Also drop a failed/hung `getDbExec` init promise so the next call retries a fresh connection instead of re-awaiting a permanently rejected/pending one.
- 482e9db: Add SEO-friendly extension URLs with generated name slugs and extension page titles.
- 482e9db: Keep auth endpoints responsive when agent chat startup stalls, and expose framework session cookie helpers for custom auth plugins.

## 0.20.8

### Patch Changes

- a07d19c: Fix session.orgId always being undefined

## 0.20.7

### Patch Changes

- e06d8ab: Keep Builder iframe Google sign-in on the popup path when redirects cannot work.

## 0.20.6

### Patch Changes

- 52adc2d: Keep Builder.io connect popups alive when the click-time status refresh fails by falling back to the recently fetched signed connect URL.

## 0.20.5

### Patch Changes

- a470349: Clear the chat drop overlay when the composer consumes dropped files.

## 0.20.4

### Patch Changes

- dab88cd: Prevent dropped screenshots in the agent composer from attaching twice.

## 0.20.3

### Patch Changes

- 76b5268: Stop closed agent sidebars from mounting hidden polling surfaces on page load.

## 0.20.2

### Patch Changes

- f343737: Use the shared popover primitive for the composer model picker and keep the menu stable while model groups expand.
- f343737: Fall back to redirect Google sign-in when the popup OAuth window is blocked.
- f343737: Quiet Builder credential and engine detection diagnostics unless debug tracing is enabled.
- f343737: Prompt for target agent clients during `agent-native connect` and remember the selection.
- f343737: Soften the MCP connect authorization UI and collapse existing connections by default.

## 0.20.1

### Patch Changes

- 6f3002f: Prevent integration retry timers from keeping Netlify function invocations open and retry Postgres connection timeouts.

## 0.20.0

### Minor Changes

- 3eb86c8: Add shared Code chat transcript replay, prompt attachment helpers, and injectable AssistantChat runtime adapters.

### Patch Changes

- 3eb86c8: Allow extensions to resolve vault-backed keys from the active workspace and mirror Dispatch vault saves into the shared credential store.
- 3eb86c8: Respect externally supplied Builder-backed model availability in the shared composer model picker.
- 3eb86c8: Preserve spaces between streamed Agent-Native Code transcript chunks.
- 3eb86c8: Collapse the agent sidebar by default when opening external-agent deep links.
- 3eb86c8: Bound agent chat startup/history size and surface stalled or quota-capped runs instead of retrying forever.

## 0.19.3

### Patch Changes

- 39b4db3: Harden and complete external-agent MCP connect flows for hosted and local apps.
  - A connect-minted token (or `mcp install` / ACCESS_TOKEN / production caller)
    now gets the full MCP tool surface — including mutating template actions
    like `create-document` — even in local dev, matching the documented
    external-agents contract. Previously a connected Claude Code/Codex/Cowork
    only saw framework builtins in dev, so "say it and it does it" didn't work
    against a local app.
  - `list_apps` now reports the live request origin and `running: true` for the
    app serving the request, instead of a guessed `PORT || 5173` URL with
    `running: false` (which mis-pointed cross-app deep links on non-default
    dev ports).
  - The in-app Connect page now auto-refreshes "Your connections" after a
    device authorize, so the new connection appears (with a "Connected"
    confirmation) without a manual reload.

## 0.19.2

### Patch Changes

- 046a8f2: Improve the external-agent connect screen hierarchy and device-code presentation.

## 0.19.1

### Patch Changes

- 310c02f: Add context-aware dynamic prompt suggestions to the agent chat empty state.
- 310c02f: Tighten read-only bash command guards and scope org-directory/A2A routing auth by caller org identity.
- 310c02f: Reduce production Sentry noise from expected transport and authorization errors.
- 310c02f: Share the minimal bash/read/edit/write coding tool profile between Agent-Native Code and sidebar development mode.

## 0.19.0

### Minor Changes

- b3de2db: Cross-app SSO ("Sign in with Agent-Native", Dispatch as identity authority).
  New opt-in env `AGENT_NATIVE_IDENTITY_HUB_URL`: when set, an app exposes
  `/_agent-native/identity/login` + `/callback`, redirects to the hub's
  `/_agent-native/identity/authorize`, verifies the short-lived `A2A_SECRET`-
  signed identity token (strict `scope:"identity"`, single-use CSRF state,
  `iat`/`exp` bounds), and **JIT-links to the local Better Auth user strictly by
  verified email** — existing same-email user is linked (additive `account` row
  via the adapter; the user/session rows are never modified, renamed, or
  deleted), new email is created via the normal signup path — then mints a normal
  local session. Unset = zero behavior change (fully reversible; per-app canary
  via one env var). Identity rows are only ever added to, so rolling this out
  logs users out once and they log back into the _same_ account with data intact.
  Includes the `redirect()` staged-`Set-Cookie`-on-302 fix so the session
  survives the federated callback. The Dispatch-side identity authority lives in
  the (private) dispatch template.
- b3de2db: Frictionless connect for external agents. New `agent-native connect <url>`
  (and `connect --all`) drives an OAuth-style device-code flow: a logged-in
  browser session mints a per-user, scoped, **revocable** MCP token (an
  `A2A_SECRET`-signed JWT with a `jti`) and the CLI writes the HTTP MCP server
  entry for every detected client (Claude Code desktop/CLI, Codex, Cowork) — no
  shared secret copying, no local server. Adds the framework-served
  `/_agent-native/mcp/connect` page + token mint / device-code / list / revoke
  endpoints (mounted by the core routes plugin, gated by `disableMcpConnect`),
  two additive framework tables (`mcp_connect_tokens`, `mcp_device_codes`), a
  `jti` revoke check in the MCP `verifyAuth`, and an optional `extraClaims` on
  `signA2AToken`. Connecting to hosted apps is now the primary documented path;
  local-dev `mcp install` / stdio remains as the advanced path.

### Patch Changes

- b3de2db: Fix local-dev zero-setup auto-sign-in: the session cookie is now emitted on
  the 302 itself. `maybeAutoCreateDevSession` returned a bare
  `new Response("", { status: 302, headers: { Location } })` after staging the
  session cookie via `setFrameworkSessionCookie`. h3 v2's `prepareResponse`
  only merges the event's staged response headers into a returned web
  `Response` when that Response is 2xx — its `!val.ok` early-return hands a
  non-2xx Response (like a 302) back as-is, dropping the staged `Set-Cookie`.
  A fresh `pnpm dev` therefore 302'd straight to the app and bounced back to
  the login form. A new `redirectWithStagedCookies` helper mirrors the staged
  cookies onto the redirect Response's own headers so the 302 actually carries
  the session.

  Also hardens the dev auto-account so the convenience can't become an
  exposure: it now (1) only fires for **loopback** requests — a new shared
  `isLoopbackRequest` helper (also adopted by the desktop-SSO broker) so a
  tunnelled / reverse-proxied / misconfigured-non-prod dev server never
  auto-signs-in a remote visitor; and (2) mints a **random per-DB password**
  printed to the server console once, instead of the source-code-known fixed
  `local-dev-account`, so there is no shared credential to reuse. Still gated
  on `NODE_ENV` and `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1`.

- b3de2db: Remove the "Effective context" card grid from the resources editor and replace the section-title hover tooltips (Workspace / Organization / Personal) with a dedicated small help icon. The inherited Workspace section is now hidden unless workspace context exists.
- b3de2db: Share composer submit intent, transcript normalization, and conversation scroll primitives with Agent-Native Code.

## 0.18.1

### Patch Changes

- 24049a6: External-agent bridge follow-up fixes: add `/_agent-native/mcp` to the auth
  bypass allowlist so the stdio proxy / external MCP clients reach the endpoint's
  own `verifyAuth` (was 401); static `ACCESS_TOKEN` requests now carry caller
  identity via `AGENT_NATIVE_OWNER_EMAIL`/`X-Agent-Native-Owner-Email`; `open_app`
  / `create_workspace_app` use the target app origin and `ask_app` routes
  cross-app over A2A honestly; validate decoded compose `draft.id` in
  `/_agent-native/open`; swallow benign post-flush `ERR_STREAM_WRITE_AFTER_END`;
  fix the local-dev auto-account email (`dev@local` → `dev@local.test`, rejected
  by better-auth 1.6.0) with legacy dual-exclusion.

## 0.18.0

### Minor Changes

- 921715a: Seamless bridge to external coding agents (Claude Code, Cowork, Codex). Actions
  gain an optional `link` builder; MCP tool results now append an "Open in … →"
  deep link (`_meta["agent-native/openLink"]` + markdown). New
  `/_agent-native/open` route bridges those links to the existing
  `navigate`/`application_state` mechanism, scoped to the browser session. Adds
  `buildDeepLink`/`toAbsoluteOpenUrl`/`toDesktopOpenUrl` helpers, an
  `agent-native mcp` CLI (serve/install/uninstall/status/token) with stdio
  transport + one-command install for Claude Code/Codex/Cowork, and generic
  cross-app MCP tools (`list_apps`, `open_app`, `ask_app`, `create_workspace_app`,
  `list_templates`). All additive and backward compatible.

## 0.17.2

### Patch Changes

- 480c078: Cap the Postgres connection pool to a single connection per instance on serverless runtimes (Netlify Functions / AWS Lambda). Concurrent frozen Lambda instances each holding postgres.js's default 10-connection pool were exhausting Neon/Postgres' connection limit, causing "Max client connections reached" and HTTP 500s on every `/_agent-native/*` route. Long-lived Node servers keep the normal pool.

## 0.17.1

### Patch Changes

- 8b0a941: Fix agent sidebar resurrecting an old closed tab on refresh. When all tabs were closed down to a single new empty tab, reloading the page replaced it with the most-recent old conversation because the empty tab is never persisted server-side and the in-memory newly-created marker is wiped by the reload. The saved tab is now restored verbatim as an optimistic empty tab instead of falling back to an unrelated old chat. Stale (>12h) tab clearing is unchanged.
- 8b0a941: Composer toolbar: drop the leading pencil/clipboard icon from the Act/Plan mode picker, and hide the reasoning-level suffix ("· Auto") when the chatfield is narrower than 370px so the model name + version stays fully readable instead of truncating. The reasoning level is still reachable via the model picker popover. Also alias `@agent-native/core/styles/agent-native.css` to source in dev so CSS edits take effect live instead of silently loading the stale built copy.
- 8b0a941: Refine Demo Mode redaction: only coerce a name-key value to a fake name when it's a 2–4 word person name (mail labels/tabs like "Important" no longer mangled); stable mappings via a bounded, TTL'd, leak-free cache plus produced-fake idempotency so names/emails don't drift when a draft is edited and refetched; realistic stand-in email domains instead of example.com; protect SQL/query/expression/code keys so analytics panel queries aren't corrupted by redaction (chart titles/names still faked, queries run intact); fetch interceptor hardened to be a zero-overhead pass-through when demo mode is off and to never touch agent/run/streaming transport. Plus DemoModeSection/action-routes wiring and tightened TiptapComposer, use-chat-threads, and use-db-sync behavior.
- 8b0a941: Fix Google sign-in popup showing "[object Object]" instead of redirecting to Google. The `/_agent-native/google/auth-url?redirect=1` path used h3 v2's `sendRedirect`, which (in `2.0.1-rc.20`) ignores the event and returns a non-standard `HTTPResponse` instance; the request-handler shim stringified it to `[object Object]` with a 200 status and no `Location` header. It now returns a native web `Response` 302, matching the proven OAuth response idiom used by the callback route.

## 0.17.0

### Minor Changes

- a21633b: Add demo mode: a settings toggle / `toggle-demo-mode` agent action / `DEMO_MODE` env that deterministically replaces real names, emails, and numbers with realistic fake data in every action result — for both the UI and what the agent sees. IDs, dates, URLs, and structure are preserved (protect-first tokenization + key denylist) so the app keeps working. The redaction walk is fully gated and only runs when demo mode is on.

## 0.16.3

### Patch Changes

- dbf8db4: Tag Builder connect URLs with Agent Native signup source and flow attribution.
- dbf8db4: Expose Agent Teams background runs through agent-chat Code hub-compatible run APIs.
- dbf8db4: Deliver queued Agent Teams messages to running sub-agents at safe continuation points.
- dbf8db4: Allow templates to answer inbound A2A messages through a deterministic fallback before loading an agent engine.
- dbf8db4: Add regression coverage for public A2A skills built from static action registries.
- dbf8db4: Expose local Agent-Native Code sessions through a shared background-agent run adapter.
- dbf8db4: Improve the Agent-Native Code shell intro and status context.
- dbf8db4: Polish the shared composer model menu and Code agent credential handling.
- dbf8db4: Add a reusable provider reader metadata registry for workspace connections.
- dbf8db4: Add a minimal provider reader runtime contract for granted workspace connections.
- dbf8db4: Track last-used audit metadata for reusable workspace connections and grants.
- dbf8db4: Add reusable runtime credential resolution for granted workspace connections.

## 0.16.2

### Patch Changes

- 5b9bdd7: Fix chat dictation: "auto" mode now uses browser-native SpeechRecognition when available, matching the macros-app record-button experience. Words stream incrementally into the composer with no server API key required. Explicit server providers (builder, gemini, groq, openai) are unchanged.

## 0.16.1

### Patch Changes

- 85d6554: Auto-hide sidebar tabs after 12 h of inactivity (previously 4 h, empty-only). Any tab inactive for more than 12 hours is now removed from the sidebar on load and the user is dropped into a fresh tab; older threads remain accessible via History.

## 0.16.0

### Minor Changes

- 79a0eb9: Add host bridge, React iframe helpers, screen context snapshots, typed live client actions, session metadata, approval gates, and host tool adapters for embedding Agent-Native sidecars in existing SaaS apps.
- 79a0eb9: Document the next Agent-Native Code follow-up features: session picker/run controls, permission modes, project slash commands, and migration as a Code workspace slash command instead of a template.
- 79a0eb9: Expose local Agent-Native Code run helpers and document the reusable Code UI/template flow.
- 79a0eb9: Add a batteries-included embedded Agent-Native runtime with host-auth server mounting, a React embedded sidebar/surface, and direct browser-session context/action registration.
- 79a0eb9: Add a SQL-backed browser-session bridge so embedded sidecars can register live host tabs, let backend agent tools inspect page context, run client actions, and send host refresh/navigation/remount commands.
- 79a0eb9: Add portable extension iframe and slot primitives for embedding SDK hosts, including manifest-gated permissions and storage adapters.

### Patch Changes

- 79a0eb9: Add org-scoped per-app default model settings for agent chat.
- 79a0eb9: Expose server-side agent loop helpers for template background workers.
- 79a0eb9: Register the Brain template in the public catalog and docs.
- 79a0eb9: Add scoped built-in MCP capability toggles for browser and computer-use servers.
- 79a0eb9: Record active Agent-Native Code follow-ups as steering or queued prompts.
- 79a0eb9: Default Agent-Native Code sessions to auto mode and add plan/auto CLI aliases.
- 79a0eb9: Expose package-provided actions through template action runners and add a full Dispatch Dreams settings editor.
- 79a0eb9: Add explicit shared composer layout variants and toolbar slot hooks.
- 79a0eb9: Expose Agent-Native Code project commands and skills as structured code-pack metadata.
- 79a0eb9: Build the core package before packing local file dependencies so generated framework workspaces install a fresh dist snapshot.
- 79a0eb9: Link the local Dispatch package during framework-development workspace creation and build Dispatch before local packing.
- 79a0eb9: Inherit Dispatch-managed workspace instructions, skills, and reference resources at runtime; seed and restore starter company, brand, messaging, guardrail, and voice resources; show and inspect each app's effective workspace context stack; gate All-app resource edits through Dispatch approvals when enabled; preview global impact and overrides before save; and expose read-only inherited workspace resources in app panels.
- 79a0eb9: Improve `/migrate` CLI handoff output with clearer Agent-Native Code resume commands and artifact guidance.
- 79a0eb9: Add the generic Agent-Native Code `/migrate` CLI entrypoint, any-input migration seeding, and own-agent dossier emit output for code-agent handoff.
- 79a0eb9: Export a reusable full-page agent chat surface backed by AgentPanel internals.
- 79a0eb9: Expose safe public-agent read-only actions in the unauthenticated agent surface.
- 79a0eb9: Expose shared workspace connection app-access semantics for reusable integrations.
- 79a0eb9: Add SQL-backed remote integration relay device, command, run-event, management, and push-registration endpoints.
- 79a0eb9: Remove legacy workspace-resource sync actions and clarify runtime inheritance docs.
- 79a0eb9: Add runtime inheritance contract coverage for workspace resources.
- 79a0eb9: Require authentication before dry-running arbitrary MCP server URLs.
- 79a0eb9: Add shared workspace connection app-grant and provider-readiness helpers for reusable integrations.
- 79a0eb9: Route Telegram `/code` commands from Dispatch to the remote code-agent relay.
- 79a0eb9: Add a typed workspace connection provider catalog for reusable integration metadata.
- 79a0eb9: Add scoped workspace connection grant storage and helpers for connect-once, grant-to-app integrations.
- 79a0eb9: Add scoped workspace connection metadata storage for connect-once-use-everywhere foundations.

## 0.15.14

### Patch Changes

- cbd1826: Keep extension previews fresh after agent-side edits and clarify chat recovery after repeated connection failures.

## 0.15.13

### Patch Changes

- 3fda479: Fix migration template dev-port collision (8100 → 8101), emit a single canonical for /docs and /docs/getting-started, and JSON-escape generated route paths so Next.js dynamic segments can't break scaffolded TSX.

## 0.15.12

### Patch Changes

- 2cb8220: Add Agent Web surface generators, public-agent action metadata, and an audit command for crawlable public routes.
- 2cb8220: Stop the Builder connect card from spinning after popup completion when status does not confirm credentials, and show Builder as the active LLM source when connected.
- 2cb8220: Add the Migration Workbench engine, hidden migration template, CLI entrypoint, and documentation for verified Next.js-to-agent-native migrations.

## 0.15.11

### Patch Changes

- 31b3ffe: Always refresh the Builder cli-auth URL inside a freshly-opened about:blank popup on web (desktop keeps direct path), add a stable `authError` field to BuilderStatus for persisted old-credential rejection, and keep Fusion/workspace-runtime deploy keys out of the identity fallback when a signed-in user is present.

## 0.15.10

### Patch Changes

- e2d812c: Keep Builder reconnect flows alive while replacing rejected deploy fallback credentials.

## 0.15.9

### Patch Changes

- 5b2488b: Fix: default the Builder API host fallback to `https://api.builder.io` instead of the unreachable `https://ai-services.builder.io`, so calls succeed when `BUILDER_API_HOST` / `BUILDER_PROXY_ORIGIN` / `AIR_HOST` are unset.

## 0.15.8

### Patch Changes

- 3084676: Handle Builder cli-auth callback fallback for preview hosts not in Builder's allow-list, surface rejected credentials on status / Settings, scope callback postMessage to the parent origin, and self-heal credential auth-failure markers after a successful gateway call.

## 0.15.7

### Patch Changes

- d4c9097: Polish Builder connect completion by avoiding loopback callback URLs and refreshing connected chat UI.

## 0.15.6

### Patch Changes

- 54e65a6: Keep Builder connect on the active preview deployment and route chat reconnect buttons through the signed popup flow.
- 54e65a6: Keep Builder CLI auth connect URLs fresh and preview-aware in embedded Builder editor contexts.

## 0.15.5

### Patch Changes

- 86dbcea: Refresh Builder connect links inside popup click flows and use Google OAuth popups for Builder iframes.

## 0.15.4

### Patch Changes

- Refresh Builder connect links inside popup click flows and use Google OAuth popups for Builder iframes.

## 0.15.3

### Patch Changes

- b2d1228: Use popup Google sign-in for Builder web iframes and bridge the returned session back into the embedded preview.

## 0.15.2

### Patch Changes

- 73dbe40: Allow signed Builder connect flows to complete through workspace gateway origins without requiring the iframe host's session cookie.

## 0.15.1

### Patch Changes

- 10dc17f: Improve Builder preview Google OAuth popup completion, diagnostics, and callback error propagation.
- 10dc17f: Keep the pre-hydration theme script's resolved data-theme in sync with the html class.

## 0.15.0

### Minor Changes

- f400c81: Two additions to core:
  - **`AppearancePicker` + `change-appearance` action.** New per-user appearance presets (`warm` / `ocean` / `forest` / `rose` / `slate` + the default) that override the base HSL theme tokens. The runtime reads `localStorage["appearance"]` in the inline theme-init script and sets `<html data-appearance="...">` before hydration, so there's no first-paint flash. Exports: `APPEARANCE_PRESETS`, `applyAppearance`, `getStoredAppearance`, `useAppearance`, `AppearanceSync`, `AppearancePicker`. The agent can change the active preset via the new `change-appearance` core sharing action — auto-registered through `mergeCoreSharingActions`, so every template inherits it.
  - **`guard-extension-no-public.mjs`.** New CI guard wired into `pnpm guards`. Statically refuses any change that drops `allowPublic: false` / `requireOrgMemberForUserShares: true` from the extension shareable registration, or that introduces a string literal / raw SQL flipping an extension row to `visibility = "public"` outside the framework-level `set-resource-visibility` action. `sharing` skill updated to document the two new registration flags and point at the guard.

- b5b6f22: New optional `emptyStateAddon` prop on `AssistantChat` — content rendered in the empty state above the suggestion buttons. Used by `MultiTabAssistantChat` to surface "previous chats for this design" when the current thread is empty but the scope has other threads. No behaviour change when the prop isn't passed.
- 2eb5064: `PromptComposer` + `TiptapComposer`: inline image attachments, attachment-only composer-mode sends, and active-voice cancellation on submit. Image files attached to the composer are now sent inline as `<uploaded-image name=… contentType=…>` data-URL blocks alongside the existing pasted-text / inline-text flattening. Composer modes (`/code`, `/research`, etc.) now also accept submissions with no text when attachments are present — the default prompt becomes "Use the attached context." and the attachments survive the wrap in the mode's prefix + `<context>` block. Every send / build intercept path also cancels any in-flight voice dictation so a late transcript can't land on top of the just-sent message.
- 97ca0db: Export `useBuilderStatus` and `useBuilderConnectFlow` (plus `BuilderConnectFlow` / `BuilderConnectFlowOptions` types) from `@agent-native/core/client`. Both hooks already powered the in-framework SettingsPanel's Builder.io connect flow; surfacing them lets templates reuse the same status read + connect-flow state machine in their own settings UIs without duplicating the SSE / popup-handshake plumbing.
- f400c81: Polish + appearance presets:
  - Sign-in page: add a favicon `<link>` to the onboarding sign-in and reset-password HTML so tabs no longer show the default globe.
  - Sign-in page: suppress the on-screen Google OAuth status overlay ("OAuth exchange redeemed; returning to the app (flow …)" and friends) for end users. Diagnostics still log to the browser console; the overlay can be opted back in with `#oauth-debug` or `?oauth_debug=1` for debugging.
  - Feedback popover: placeholder now leads with concrete examples ("e.g. 'The Send button isn't obvious'…") so users have a clearer prompt than "Tell us what's on your mind…".
  - **New: Appearance presets.** Users can pick a color theme without editing source. Adds a `change-appearance` action (auto-mounted everywhere) that the agent can invoke as a tool, a `<AppearancePicker />` React component for Settings pages, a `useAppearance` / `useAppearanceSync` hook pair, and CSS preset overrides (`warm`, `ocean`, `forest`, `rose`, `slate`) layered on top of each template's base palette via `<html data-appearance="…">`. The theme init script now also applies the stored preset on first paint to avoid FOUC.
  - Agent system prompt now includes a short first-session personalization flow: greet, ask two yes/no questions (theme preset via `change-appearance` plus one template-specific preference), then mark `application_state.personalization = { done: true }` so it never re-asks.

- d1a90ac: Image uploads and drag-and-drop, framework-wide.
  - New `upload-image` agent action — converts a base64 data URL or remote URL into a hosted CDN URL via the active file-upload provider (Builder.io by default, or any provider registered with `registerFileUploadProvider` — S3, R2, GCS, etc.). Auto-registered for every template alongside the sharing actions; the agent now has an explicit tool to materialize chat-attached or generated images as stable URLs for slides, documents, and outbound messages.
  - File-upload registry now uses a `globalThis`-backed singleton. The previous module-level `Map` could be evaluated more than once in some Vite/Nitro bundle-split scenarios — the plugin that called `registerFileUploadProvider()` lived in one module instance and the request handler / server-side pre-upload lived in another, so the call site saw an empty map even though registration succeeded. Custom providers (S3/R2/GCS) and the dev-mode upload path now both see the same map regardless of how the bundler chunked them; Builder.io was unaffected because it has an env-var fallback in `uploadFile()`.
  - Server-side pre-upload of chat image attachments: when a user attaches an image to the agent composer, the framework now uploads it through `uploadFile()` before the model runs and injects a `<chat-image-attachment url="..." />` block at the bottom of the user message. The model still receives the image as multimodal vision content; it just also has the hosted URL to embed in HTML. If no provider is configured, the framework injects a `<chat-image-attachment-upload-error>` block instructing the agent to suggest connecting one.
  - Chat-wide drag-and-drop: the agent sidebar now accepts file drops anywhere on the chat surface (thread, header, composer), not just inside the contenteditable. A "Drop to attach" affordance highlights the chat while files are being dragged over it.
  - Slides drag-and-drop fixes: `/api/assets/upload` now routes uploads strictly through the framework `uploadFile()` provider chain. The previous local-disk path that wrote into `public/uploads/` is gone — it didn't persist on serverless deploys and polluted the source tree on dev runs. With no provider configured, the endpoint returns a clear 503 telling the caller to connect Builder.io (or any registered provider). `listAssets` / `deleteAsset` no longer scan local disk; listing is a no-op for now (until a SQL-backed asset index lands), and deletes go through the provider's own API. Drops anywhere on the slides editor — including the chrome and sidebars — are caught instead of letting the browser navigate to the file; drops outside a placeholder/`<img>` open a popover that hands the image off to the agent chat for the user to describe what to do with it.

- f400c81: Two related additions to the realtime + agent layer:
  - **Per-source change-version primitive.** New `useChangeVersion(source)` / `useChangeVersions(sources)` / `getChangeVersion` / `bumpChangeVersion` exported from `@agent-native/core/client`. Every `recordChange` event carries a `source` and `version`; `useDbSync` now bumps a per-source counter on each event and templates fold the counter into their React Query `queryKey`, so a change to `"dashboards"` only refetches dashboard queries instead of triggering a blanket cache invalidate across the app. Framework-level keys (`action`, `extension`, `application-state`, …) keep their universal invalidate; template data keys (`data`, `dashboards`, `analyses`, `dashboard-views`) no longer do — they react through the per-source counter. Analytics templates updated as the first consumer (CommandPalette / Sidebar / sql-dashboard / AnalysesList).
  - **Scoped chat tabs in `AgentPanel` / `MultiTabAssistantChat`.** New optional `scope?: ChatThreadScope | null` prop on `AgentPanel`. When set, the tab bar partitions per `(storageKey, scope)` so each deck / dashboard / record shows its own thread list, new chats inherit the scope server-side, and the panel renders a "Working on {label}" badge with a Detach button to escape back to the unscoped tab list. Pairs with the server-side `scope_type` / `scope_id` / `scope_label` columns + `setThreadScope` already in `chat-threads/store.ts`.

- ffd3d00: Add first-class workspace app audience metadata with route-level public/protected page access.
- d1a90ac: `ShareButton` now accepts an optional `shareUrlPlaceholder` prop. When the primary `shareUrl` is undefined the popover shows the placeholder inside a subtle dashed-border slot instead of hiding the link section silently. Use it to tell respondents _why_ there's no link yet (e.g. "Publish this form to get a public response link") so the popover doesn't look broken on draft / unpublished resources.
- 5f59f44: Browser tracking now sends a persistent `anonymousId` (visitor ID) and a `sessionId` with a 30-minute idle timeout on every event posted to the Agent Native Analytics `/track` endpoint. Both IDs are stored in `localStorage` and degrade gracefully to NULL when storage is unavailable (private browsing). Unique-visitor and session metrics in the analytics template now have real data to aggregate against; previously these columns were always NULL for anonymous traffic.
- c6defe7: Real-time sync, take 2: per-source change counters.

  The previous attempt — invalidating every active React Query on any non-own change event — caused a request storm on the analytics dashboard (461 pending requests, polls timing out at the 10s abort). This change replaces it with a targeted, default-on mechanism:
  - New `useChangeVersion(source)` and `useChangeVersions(sources)` hooks return an integer that advances every time the server emits an event with that source (`"dashboards"`, `"analyses"`, `"action"`, `"settings"`, `"app-state"`, etc.). `useDbSync` keeps a per-source counter and bumps it from every poll/SSE event it sees.
  - Templates fold the counter into the relevant React Query `queryKey`. When the source advances, the queryKey changes and React Query refetches that one query — no whole-cache invalidate, no fanned-out refetches across unrelated panels. `placeholderData: (prev) => prev` keeps the old data on screen during the refetch so there's no flicker.
  - `useDbSync` reverts to invalidating a small fixed list of framework-internal prefixes (`["action"]`, `["app-state"]`, `["__set_url__"]`, etc.) and no longer touches templates' own data queries. The legacy `queryKeys` option remains in the type signature for backward compatibility but is ignored.
  - Analytics' dashboard / analysis / sidebar / command-palette queries are wired up. Other templates can adopt the same pattern by importing `useChangeVersion` and including it in their query keys; recommended sources include `"dashboards"`, `"analyses"`, `"settings"`, and `"action"` (the agent runner emits `source: "action"` after every successful mutating tool call, so depending on it catches any agent-driven change to the underlying data).

- 5f59f44: New `usePinchZoom` hook exported from `@agent-native/core/client` for canvas-style editors. Wires trackpad pinch (synthesized as `wheel` events with `ctrlKey: true`) and 2-pointer touchscreen pinch onto a scrolling container, with cursor-anchored zoom-to-cursor support and configurable `min` / `max` percentages. The slides template adopts it on the deck-editor canvas; any template with a zoomable surface can drop it in by attaching the returned ref to the scroll container.

### Patch Changes

- d1a90ac: Agent chat: when the user sends a new message after scrolling up to read history, scroll back to the bottom so the new message and reply land in view. Previously the sticky-bottom override (which exists to stop streaming from yanking the viewport) also swallowed direct sends, leaving the user stuck in old history.
- ffd3d00: Emit agent sidebar open-state events so custom toolbar buttons can track when the chat panel opens or closes itself.
- d1a90ac: Local-dev convenience: skip the sign-up wall on a freshly-scaffolded app. When `NODE_ENV=development` and the `user` table has no rows for any email other than `dev@local`, the auth guard transparently signs up + signs in an auto-managed `dev@local` account on the first page GET and 302s back to the original URL with the session cookie set. A developer who just ran `pnpm dev` lands in the app immediately instead of being asked to fill in name + email + password to try the framework. Once a real user signs up via the regular form, the email-filter short-circuit fires and this helper returns null on every subsequent request, so the normal login flow takes over. Set `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1` to opt out.
- 5f59f44: Docs only: spell out the auto-refresh contract in the default-template and starter `AGENTS.md` so newly-scaffolded apps know that agent writes must reflect in the UI without a manual refresh. Use `useActionQuery` (auto-covered) or fold `useChangeVersions([<source>, "action"])` into raw `useQuery` keys. Mirror the framework `adding-a-feature` and `real-time-sync` skills into `packages/core/src/templates/default/.agents/skills/` and `templates/starter/.agents/skills/` so scaffolded apps inherit the same guidance.
- d1a90ac: Builder credential resolution: implicit-org fallback + trace logging.
  - `agent-chat-plugin`: when `session.orgId` is null (Better Auth leaves it null until the user explicitly switches orgs), fall back to `getOrgContext()` to pick up implicit org membership. A fresh signup with a domain-matched org now sees its org-scoped Builder credentials instead of looking unconnected.
  - `resolveSecret`: log every Builder credential lookup (`[resolve-secret]` lines covering hit/miss + scope + email + orgId). "I connected Builder but chat says no LLM" reports can now be diagnosed from server logs without rerunning the request. Other keys are gated behind `DEBUG_CREDENTIAL_RESOLVE=1` to keep noise low.
  - `core-routes-plugin` builder-connect: log the resolved write scope so we can see which scope (user/org/workspace) a connect actually persisted to.

- d1a90ac: Add inline "Start new chat" button to no-detail Builder gateway error messages. When the gateway returns `{type:"stop",reason:"error",requestId:...}` with no diagnostic, the error UI now renders a one-click CTA next to the message instead of just telling the user to start a new chat manually. The button dispatches an `agent-chat:new-chat` window event that `MultiTabAssistantChat` listens for, matching the existing close-tab event pattern.
- a89082e: Builder reconnect now clears stale credentials before writing the new connection, so reconnecting with a different Builder space actually takes effect.

  `writeBuilderCredentials` previously upserted each new key but left stale rows in place. Two failure modes:
  - Reconnecting with a Builder space that doesn't carry every optional field (e.g. no `orgName`/`orgKind`/`userId`) left the previous connection's metadata behind at the target scope, so the gateway saw a mix of new and old credentials.
  - When a user's first connect wrote at user scope (member or no-org) and a later reconnect wrote at org scope (now owner/admin), the old user-scope row still won resolution — user scope beats org scope by design — so the chat kept using the old Builder space's credentials even though the UI showed the new connection.

  Fix: before writing, delete all five `BUILDER_*` keys at the target scope, and when writing at org scope also delete the writer's user-scope rows. The org-scope row is intentionally left alone when writing at user scope so a single user's personal override doesn't blow away the team's shared connection.

  Reported as "I signed in again with my Builder space not my own one and still telling me I need to upgrade" on 2026-05-11.

- d1a90ac: `builderFileUploadProvider`: retry transient 5xx once with backoff (600ms then 1.8s).

  Builder.io's upload service occasionally returns a bodyless 500 ("Internal Error") on the first attempt — usually GCS write hiccups that succeed on retry. Three template surfaces that hit this on every recording / upload (Clips finalize, attachment uploads, generated-image uploads) now get those transient failures absorbed silently. Deterministic 500s still surface to the caller after the third attempt with the original status + body.

- ad4f135: Keep the in-app agent panel active inside Builder web previews instead of treating them as local dev frames.
- ffd3d00: Recover the agent panel automatically when assistant-ui renders a stale list index.
- ffd3d00: Clarify scoped chat context copy in the assistant sidebar.
- 64792af: Clarify Builder Cloud Agent waitlist guidance so agents do not send users to nonexistent org settings.
- d1a90ac: CLI + dispatch shell fixes from create-workflow feedback:
  - `create`: scaffold `packages/pinpoint` when the user selects `slides` or
    `videos`. Their `package.json` declares `@agent-native/pinpoint:
workspace:*`, but the templates-meta entries were missing
    `requiredPackages: ["pinpoint"]`, so `pnpm install` blew up with
    `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`. The existing e2e test now covers
    every template with `@agent-native/*` workspace deps so a regression
    surfaces in CI instead of on the user's machine.
  - `create`: per-template progress messages during scaffolding
    (`Scaffolding Slides (3/4)...`, `Adding shared packages...`) and a
    concrete "this is done" stop message, replacing the single static
    "Working... no action needed" line that made a multi-app workspace
    feel hung.
  - `create`: detect `pnpm` on PATH before printing the outro. If it's
    missing, the next-steps block now leads with `npm install -g pnpm`
    instead of dumping the user at `zsh: command not found: pnpm`.
  - `create`: Dispatch is now always scaffolded into a new workspace
    rather than being a recommended-but-optional pick. The picker only
    lists the optional apps; the workspace note explains that Dispatch is
    always included as the control plane. `--template=forms` (or any
    non-Dispatch list) still works — Dispatch gets unioned in. New
    regression test asserts this.
  - Auth guard: local-dev convenience for `NODE_ENV=development`. When
    the `user` table has no real users yet, the first unauthenticated
    page GET transparently signs up (and signs in) a `dev@local` account
    and 302s back to the requested URL, instead of showing the sign-up
    form. A developer running `pnpm dev` lands straight in the app. Once
    any real account exists the auto-create short-circuit fires and the
    regular login flow takes over. Opt out with
    `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1`. Production is unaffected.
  - `DispatchShell`: page-title info icon is now a click-driven Popover
    instead of a hover-only Tooltip, and the trigger button has a
    proper hover background so it reads as clickable. Clicking the icon
    (the natural gesture, and the only available one on touch) did
    nothing before.
  - `create`: clean up the partially-scaffolded directory when scaffolding
    fails (e.g. flaky network during the template download). Without this
    the first failure left the workspace dir on disk, and the next
    `agent-native create <name>` rejected the same name with "Directory
    already exists" — forcing a manual `rm -rf` before retrying.
  - Dispatch apps list: filter dotfile directories (e.g.
    `.agent-native-tmp-*` extraction sidecars) when reading the
    workspace's `apps/` directory. The temp dir is a sibling of the
    target so it appeared at the top of the apps grid mid-scaffold,
    looking like a stray entry.
  - Dispatch onboarding: register a "Create your first app" step at order
    5 so it sits above the Slack/Telegram secret-onboarding steps. A
    brand-new workspace was leading with "Connect Slack" before the user
    had even added an app, which felt confusing.
  - Agent system prompt (chat-in-browser-on-localdev): when a user asks to
    scaffold a new workspace app from a localhost browser tab, point them
    at \`npx @agent-native/core@latest add-app\` first since they're already in
    that terminal. The desktop / Claude Code / Codex / Builder.io
    alternatives still follow for general source-editing work.

- ffd3d00: Add Cmd/Ctrl+Backslash as a global shortcut for toggling the agent sidebar.
- 04c3ed9: Coach users through stalled agent tasks with clearer troubleshooting and next-step guidance.
- b5b6f22: `TiptapComposer`: when a caller passes a custom `actionButton`, render only the model selector + plan-mode toggle on the left side (skipping the voice/file/send cluster that the default action-button slot owns). Without this, callers that already render their own send button got a duplicate-looking trailing block. No behavior change when `actionButton` isn't passed.
- 2eb5064: `AssistantChat`: hide the empty user-message bubble when the text content is nothing but an injected `<context>...</context>` block. Previously, sending an attachment-only composer-mode message (e.g. `/code` with a file but no prose) rendered an empty grey bubble in the chat after the context tags were stripped. The message now skips the bubble + expand/collapse UI entirely when the only attachment is context; attachment chips still render above.
- 2eb5064: `useDbSync` + server poll: per-key invalidation for application_state one-shot commands. The poll loop now emits one event per changed (key, owner) pair instead of a single `key: "*"` wildcard, and the client only invalidates `navigate-command` / `show-questions` / `__set_url__` queries when those specific keys actually change. Noisy app-state keys (template-specific UI state, per-tab flags) no longer wake the navigation / question readers on every poll cycle.
- 2eb5064: `useVoiceDictation`: cancelling while the transcription request is in flight now actually drops the response. Previously `cancel()` returned early for any state other than `recording` / `starting`, so once the network POST started, a cancel click was a no-op and the transcribed text would still be inserted into the composer after the user cancelled. The fetch handlers (both success and live-snapshot fallback) now check `cancelledRef` immediately after the await and bail without forwarding.
- 64792af: Keep Builder connect popups from replacing the Agent Native desktop webview.
- ddcc773: Raise shadcn floating-UI primitives (Dialog, AlertDialog, Sheet, Drawer, Popover, DropdownMenu, Tooltip, HoverCard, ContextMenu, Menubar, Select) from `z-50` to `z-[250]` so modal overlays cover the agent sidebar header (`z-[240]`). Fixes the case where the "Add Calendar" (and similar) modal opens but the agent chat panel underneath stays visible and interactive.
- f400c81: Add `create-pylon-ticket` action to Dispatch for escalating blockers, unmatched `#customer-*` routing, or follow-ups that need tracking — uses `PYLON_API_KEY` from the Vault. Instrument the agent chat with Sentry captures when the auth-error card stays visible past auto-recovery (`auth_error_card_stuck`) and when SSE reconnect times out (`reconnect_no_progress`) so we can chase the "occasional Reload UI required" symptom.
- b7e7d17: Route the Dispatch thread debugger through workspace root aliases.
- 04c3ed9: `workspaceAppRouteAccessFromPackageJson` now returns optional `publicPaths` / `protectedPaths` so consumers can distinguish "field absent" from "field explicitly empty." `workspace-deploy`, `workspace-dev`, and `agent-discovery` prefer the package.json value whenever it was set (even `[]`), so an app owner can clear an inherited manifest override by writing `"publicPaths": []` in its `package.json`.
- f400c81: Restrict extensions to private/org sharing only — extensions execute code in
  the viewer's authentication context, so they must never be `visibility: "public"`
  and user shares must target someone already in (or invited to) the org.
  - Added `allowPublic` and `requireOrgMemberForUserShares` flags to
    `registerShareableResource()`. Defaults match prior behavior; extensions
    opt into both.
  - `set-resource-visibility` rejects `"public"` for any resource registered
    with `allowPublic: false`. `accessFilter` and `resolveAccess` treat any
    stored `'public'` row as private for those resources (defense in depth).
  - `share-resource` verifies the principal email against `org_members` and
    pending `org_invitations` when `requireOrgMemberForUserShares: true`. The
    same flag also pins `principalType: "org"` shares to the resource's own
    org — cross-org org-principal shares would otherwise let an outside org's
    members run extension code in the viewer's auth context (same threat
    model as a public extension).
  - `updateExtension` and the extension `PUT` route refuse `visibility: "public"`
    directly. `list-resource-shares` returns a `policy` block so the share
    popover hides the "Public" option and shows server errors inline.
  - New `scripts/guard-extension-no-public.mjs` (wired into `pnpm guards` /
    `pnpm prep`) statically enforces that the extension registration keeps
    both flags set, and refuses `visibility: "public"` literals inside
    `packages/core/src/extensions/`.

- d1a90ac: Fixes for feedback from QA pass:
  - **Content** (`templates/content`): deleting the page you're currently viewing now navigates to the landing page **before** the delete round-trip resolves, so the editor doesn't sit on a now-deleted page while the request is in flight. The page-id route also redirects to `/` when the document fetch returns 404, so refreshing on a stale URL no longer dead-ends at "Document not found".
  - **Design** (`templates/design`): clicking the Edit tab no longer auto-collapses the agent chat. Previously, entering edit mode dispatched `agent-panel:close` so the EditPanel and canvas could share the screen, but the chat dropping out shifted the toolbar and removed the user's working context. Properties and chat now coexist as adjacent right-side panels.
  - **OrgSwitcher** (`packages/core`): clicking "Create organization" or "Invite member" now clears any leftover input from a previous session before entering that mode. Previously, the create form could re-open prefilled with the just-created org's name, making the switcher look like a create dialog for the new org.

- d1a90ac: Several feedback fixes:
  - **Dispatch back-button to `/dispatch/dispatch/overview`.** `dispatchNavLinkTarget` (the helper that decides whether NavLink should manually prepend the workspace mount prefix) read `window.__reactRouterContext.basename` to detect the router's basename. If that global wasn't set yet at render time, the helper double-prefixed the `to` prop, the router then prepended its own basename, and the resulting `/dispatch/dispatch/<route>` landed in browser history — clicking back from any dispatch page later took the user to that 404. The helper now mirrors `entry.client.tsx`'s basename calculation directly from `window.location.pathname`, removing the context-global race. `routerPath` (in both the package and the template copy) also iteratively strips the basename so any doubly-prefixed path that snuck into `application_state.navigate` doesn't get partially-stripped here and re-prefixed by the router back to the bad URL.
  - **"Use Builder" CTA stuck after connect (web).** The Builder upsell CTA in `AgentPanel` opens Builder in a `<a target="_blank">` tab, not a popup, so it never started the `useBuilderConnectFlow` polling loop — `useBuilderConnectUrl` was fetched once on mount and never refreshed, leaving the CTA in the "Use Builder" state after the user came back to the original tab. The callback success HTML now posts a `builder-connect-success` BroadcastChannel + window.opener message (mirroring the existing error-path broadcast), and `useBuilderConnectUrl` listens on BroadcastChannel + `window.message` + `focus` + `visibilitychange` + the existing `agent-engine:configured-changed` event, refetching `/builder/status` on any of them. Also dispatches `agent-engine:configured-changed` when status first reports configured so the rest of the chat tree updates without a full reload.
  - **Firebase `auth/popup-blocked` in desktop Builder connect.** Builder's `/cli-auth` page signs into Google via `signInWithPopup`, which calls `window.open()`. Inside the Electron OAuth `BrowserWindow` we create for the Builder flow, there was no `setWindowOpenHandler`, so Electron's default silently blocked the popup — Firebase reported `auth/popup-blocked`, the parent OAuth window never received the result, and the user saw a blank screen that then closed. The OAuth window now returns `action: "allow"` for https child popups and constructs the child as another `BrowserWindow` sharing the same `session` so Firebase's `window.opener.postMessage` handshake reaches back.
  - **`resolveScopedBuilderCredential` tracing.** The Builder credential lookup walked user → org → workspace silently; when "I connected Builder but chat says use Builder" reports come in, there was no way to tell which scope answered or whether none did. Each branch now logs the scope, email, orgId, and hit/miss outcome (matching the existing always-on tracing in `resolveSecret` for BUILDER\_\* keys).

- ffd3d00: `forkThread` now overlays the in-memory snapshot on top of the persisted row when the snapshot is fresher (more messages) than what's in SQL. Previously, once any version of the source row existed in the database, the snapshot was ignored — so forks could lose the latest unflushed user message, which is exactly the scenario chat-fork-from-unflushed is meant to fix. Guarded with `snapshot.messageCount > stored.messageCount` so a stale snapshot from another tab can't clobber a fresher persisted row.
- ffd3d00: `AgentPanel` no longer emits a synthetic `{ open: false }` sidebar-state event on mount when the parent frame owns the sidebar. The dispatch is now deferred until the frame sends its first `agentNative.sidebarMode` message, so listeners initialize with the real state instead of seeing a false → true flip a moment later.
- 64792af: Avoid double-submitting Builder chat prompts from embedded app composers by using a single iframe transport when a parent frame is available.
- 9c991e1: Keep Builder preview Google sign-in from returning to loopback preview URLs.
- ce9e355: Open primary Google sign-in from Agent Native Desktop through the desktop exchange flow so OAuth can complete in the system browser.
- ce9e355: Add LLM connection context to tracking events and track Builder connect clicks.
- 97ca0db: Export `useBuilderStatus` and `useBuilderConnectFlow` from `@agent-native/core/client` so template settings pages can render a connect-builder button that polls for completion instead of a bare `<a target="_blank">` link.
- 1fd5856: Allow owners to manage legacy unscoped shared resources after joining an organization.
- d1a90ac: Org polish:
  - `InvitationBanner`: while a join-by-domain or accept-invitation request is in flight, render an in-place "Joining {orgName}…" status so the chat panel doesn't look unchanged until the view abruptly swaps.
  - `OrgSwitcher`: `settingsPath` is now optional. When unset, "Workspace settings" only opens the in-sidebar settings panel — suitable for templates without a dedicated team page. Templates that mount one (e.g. Dispatch's `/team`) pass it explicitly.
  - `useOrgMembers` / `useOrgInvitations`: scope the React Query cache by active `orgId` so switching/creating an org forces a fresh fetch instead of briefly showing the previous org's members.
  - `useCreateOrg`: invalidate all queries on success (creating an org switches into it server-side, so every org-scoped query is stale), matching `useSwitchOrg`.
  - Create/invite forms: loader uses flex centering so the spinner stays vertically centred inside the button; close the create-org dialog via the unified `handleOpenChange` so cleanup runs.

- ce9e355: Add app navigation links to the organization switcher, with Dispatch pinned as the workspace hub.
- ffd3d00: Standardize the organization switcher settings link around template team pages.
- ad4f135: Use polling file watchers for workspace dev in managed remote containers to avoid Linux inotify limits.
- 64792af: Recover auth sessions when stale duplicate cookies shadow a fresh sign-in.
- b7e7d17: Hide agent-created scratch resources from workspace file lists by default.
- 64792af: Recover the agent chat message list when assistant-ui briefly renders a stale message index.
- ad4f135: Seed shadcn-aware frontend design skills in generated apps and workspaces.
- 13284b1: ErrorBoundary: "Go home" now triggers a full page reload (was client-side
  `<Link>`), so a signed-out visitor who lands on an error page is taken
  through the server auth guard's sign-in flow instead of getting stuck on
  a logged-in route with failing API calls. Also softens the 404 message
  to a plain "We couldn't find this page." for end users — the previous
  copy mentioned Dispatch and "shipping" routes, which only made sense to
  developers working on workspace apps.
- ffd3d00: Make chat forking work when the source thread has not flushed to SQL yet.
- ffd3d00: Redirect mounted Dispatch workspace roots to the overview page across workspace deploy presets.
- 04c3ed9: Surface workspace app startup timeouts instead of looping forever on the gateway wake screen.
- ce9e355: Send a larger default output-token budget through the Builder gateway so long Plan Mode responses do not inherit a short gateway default.
- ce9e355: Scope agent chat screen and URL context to the originating browser tab.
- d1a90ac: Fix Builder "Upgrade at builder.io" link in chat dropping users on `/app/projects` instead of billing. The link previously deep-linked to `/app/organizations/<BUILDER_ORG_NAME>/billing`, but `BUILDER_ORG_NAME` is the org's display name (e.g. `Nicholas kipchumba Space`), not a URL-safe slug — Builder's router didn't recognize it and silently redirected to `/app/projects`. The CLI-auth callback doesn't expose an org slug or id today, so the link now always points to `https://builder.io/account/billing`, which resolves the active org from session.
- d1a90ac: Promote `upload-image` to a core sharing action: register it in `mergeCoreSharingActions` so every template inherits the agent-callable image-upload tool without each app having to re-declare it in `actions/`.
- ce9e355: Default Dispatch vault access to all workspace apps, add manual grant mode, sync vault keys into encrypted app secrets, and fix org-scoped vault listing.
- ce9e355: Save generated workspace app descriptions, make Dispatch app metadata editable, and include workspace app names/descriptions in A2A agent context.
- ce9e355: Workspace dev gateway pages (loading + index) now respect `prefers-color-scheme` and render in dark mode when the user's OS is set to dark.
- 64792af: Show workspace dev child-process failures on the startup page instead of hiding them behind a generic reload loop.
- d1a90ac: CLI: probe each app's port before spawning Vite so the workspace dev server doesn't die on a single port conflict. `pnpm dev` previously assigned each app a fixed port (`8100`, `8101`, …) and spawned Vite with `--strictPort` for the gateway routing; if anything on the host already owned that port, Vite failed hard before the gateway could route around it. The workspace now binds a probe TCP socket on each candidate port before commiting to it, increments past collisions, and logs the substitution. The same probe runs in the live filesystem-sync path so a newly-scaffolded app added with `agent-native add-app` doesn't trip on a busy port either. Includes a related CLI scaffolding spinner tweak — the per-app message now distinguishes "Downloading X template…" (slow GitHub fetch) from "Configuring X…" (fast local rewrite) so users don't watch a frozen "Scaffolding…" message during the network step. `runWorkspaceDev` is now async (returns `Promise<WorkspaceDevHandle>`); the two in-tree callers already chained `.then()`, so no external API change.
- ce9e355: Prefer the public auth origin (`APP_URL` / `BETTER_AUTH_URL` / `WORKSPACE_OAUTH_ORIGIN`) over the workspace gateway URL when resolving Google OAuth redirect URIs, on both server and client. Filter out loopback gateway origins so dev workspaces don't accidentally redirect to localhost in production. The workspace dev runner forwards the resolved origin to per-app processes via `VITE_WORKSPACE_OAUTH_ORIGIN`.
- ad4f135: Keep workspace OAuth and app URL resolution on configured public origins before falling back to local workspace gateways.
- b7e7d17: Allow the Workspace tab to load without desktop code access.

## 0.14.8

### Patch Changes

- db11073: Fix workspace scaffolds of `slides` and `videos` failing with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` for `@agent-native/pinpoint`. Both templates depend on pinpoint but were not declaring it in `requiredPackages`, so it never got copied into `packages/pinpoint` and the `workspace:*` reference could not resolve.

## 0.14.7

### Patch Changes

- 63e641a: Add rich Sentry tags (model, gatewayOrigin, gatewayRequestId) for no-detail Builder gateway errors and fix the user-facing copy to stop promising auto-recovery and model switching, which don't actually help for this error code.
- 63e641a: Stop `Error: socket hang up` unhandled rejections from polluting Sentry on
  AWS Lambda (Sentry AGENT-NATIVE-BROWSER-4 — 24k events / 199 users in 48h).
  The MCP `StreamableHTTPClientTransport` opens long-lived sockets for SSE
  long-polls; AWS reaps those sockets ~60s after a Lambda invocation returns
  200, and the next thaw delivers a `Socket.socketOnEnd` whose Promise has
  nobody left to await it. Two changes:
  - `server/sentry.ts` `beforeSend` drops `socket hang up` events whose
    mechanism is `onunhandledrejection` and whose stack includes
    `Socket.socketOnEnd` / `node:_http_client`. Real socket-hang-up errors
    with a different mechanism or non-HTTP-client stack still report.
  - `mcp-client/manager.ts` attaches a no-op `transport.onerror` before
    `client.connect()` so SDK fire-and-forget paths (initial SSE stream
    open, scheduled reconnects) can't surface as unhandled rejections in
    the window before Client wires its own handler. `Client.connect()`
    chains its own onerror on top of ours, so post-connect errors still
    flow through the existing `client.onerror` recorder.

- 63e641a: Fix `MessageRepository(addOrUpdateMessage): Parent message not found` unhandled
  rejection in the agent prompt composer (Sentry AGENT-NATIVE-BROWSER-18). The
  assistant-ui local runtime can clear or relink its message map between the
  `append` that adds the user message and the `performRoundtrip` call that
  records the assistant placeholder (history-adapter load, branch reset, repeat
  imports). When that race fires the runtime threw an internal-bug error that
  masked the original error from chatModel.run() and surfaced as a Sentry
  unhandled rejection on the user's first send. The fix patches the underlying
  `MessageRepository.addOrUpdateMessage` to relink the message to the current
  head (or root) when the requested parent is missing, instead of throwing.

## 0.14.6

### Patch Changes

- 7992922: Hide the CLI tab in the agent sidebar when embedded inside the Builder.io frame. Code editing in that context happens via Builder, and the CLI panel only offered a Download Desktop CTA, so the tab added clutter without value. If the persisted panel mode was `cli`, it now auto-switches to `chat` once embedded.
- 7992922: fix(chat): three related chat-history fixes that landed together.
  - New `normalizeThreadRepository()` walks an imported repo, drops messages without an id, and rewrites missing or dangling `parentId` references to the previous-seen message id (or `null` for the head). assistant-ui's `threadRuntime.import()` rejects the whole repo with `Parent message not found` if even one entry has a stale parent, which used to wipe the entire thread on refresh after a partial save. Both `mergeThreadDataForClientSave` (server-side merge) and `AssistantChat`'s import path now run through it.
  - `chat-threads/store` derives `messageCount` from `thread_data` on read via `normalizeThreadRepository`, and drops summary rows where the derived count is `0`. The chat-history sidebar now reflects only real conversations even if a row sneaks in with `message_count = 0`.
  - `isInternalContinuationError` no longer classifies `builder_gateway_error` (or the loose `"gateway error"` message-substring match) as a continuation. PR #634 dropped this code from the client's auto-recover allow-list and capped the server retry budget; this finishes the picture so the visible thread surfaces a normal error card instead of hiding the failure behind the silent-continuation filter.
  - Thread-data writes now use an `updated_at` compare-and-swap retry loop and remerge message history against the latest DB row before each retry, so cross-process serverless writers no longer blindly clobber each other. Client restore/reconnect also refuses obviously stale server snapshots that would replace a richer local runtime.

- 7992922: Add `?authMode=popup` / `?authMode=redirect` query-param override to the Google sign-in flow, allowing per-session testing of either flow without flipping the global `GOOGLE_AUTH_MODE` env var or shipping a default-behavior change.

## 0.14.5

### Patch Changes

- fa3189e: fix(thread persist): every user message was getting duplicated in `chat_threads` because the runtime export (assistant-ui's `saveThreadData`) wrote `attachments: []` while the server-side `persistSubmittedUserMessage` → `buildUserMessage` path omitted the field entirely. The fingerprint used to dedupe in `messageIdentityKeys` couldn't see them as the same message — `[]` and `undefined` hashed differently. Now normalize the attachments slot through `normalizeAttachmentIdentity` (which collapses both shapes to `undefined`) so duplicates merge instead of stacking up as `client_user → assistant → server_user` triples.
- fa3189e: Mirror Google Slides' sharing behavior in the framework `ShareButton` and SSR runtime:
  - Wrap SSR loaders in `runWithRequestContext` so React Router loaders see the signed-in user via `getRequestUserEmail()` / `accessFilter()`. Fixes a bug where shared admins (and even owners) hit 404 on access-controlled SSR routes unless visibility was set to public.
  - `ShareButton` now supports an optional `secondaryShareUrl` (with `secondaryShareUrlLabel` / `secondaryShareUrlDescription`) so a resource can expose two copyable URLs — e.g. an editor link and a read-only / presentation link — in the same share dialog.
  - `shareUrlRequiresPublic` (and the related `shareUrlUnavailableDescription`) is now a no-op and deprecated. Access is enforced on the resource itself, not the URL shape, matching Google Slides — copying a link no longer requires flipping visibility to public.

## 0.14.4

### Patch Changes

- e9d5dac: Return Builder cloud OAuth completions to the active preview proxy host instead of raw loopback URLs.
- e9d5dac: fix(chat): stop the "agent regenerates the reply 4+ times in a loop" runaway when the Builder gateway emits a no-detail error

  End-to-end repro on slides production showed the agent emitting `{activity, tool_start, tool_done, tool_start, tool_done, clear, clear, clear, error}` with `errorCode: "builder_gateway_error"`, then the client sending another `POST /agent-chat` to auto-continue, which got the same gateway error, which auto-continued again — up to **4 server runs for one user message** until the gateway returned 503. Each run wiped visible content via `clear` events and re-streamed from scratch. That's the "agent does some work, deletes its reply, regenerates, gets stuck in a loop" symptom users were hitting.

  Two changes:
  - **client (`sse-event-processor.ts`):** `builder_gateway_error` is no longer in `isAutoRecoverableError`'s recoverable list. That code is the no-detail Builder gateway fallback (gateway emitted `{type:"stop",reason:"error"}` with no explanation — almost always upstream provider giving up: model quota hit, account misconfiguration, opaque downstream failure). The production-agent already retries it synchronously inside the run before the error escapes to the SSE stream, so by the time the client sees it the server has given up — auto-continuing on top of that just sends another POST that hits the same wall. Surfaces the error to the user as a "Something went wrong" card instead of looping up to 32 transient continuations. Also removed `"gateway error"` from the message-substring matcher to stay consistent with the code-based check.
  - **server (`production-agent.ts`):** Cap the in-run retry budget for `builder_gateway_error` at 1 (down from `MAX_RETRIES = 3`). Same rationale — retrying the same call against a misbehaving Builder route rarely recovers, and each retry emits a `clear` event that wipes the user's visible content. Three cycles of "regenerate, clear, regenerate" inside a single run is bad UX for a failure mode where retrying doesn't help. Other retryable codes (`http_5xx`, `builder_gateway_network_error`, rate limits, transport blips) keep the original 3-attempt budget. New `maxRetriesForError(err)` helper gates this so we can extend per-code overrides later without touching the loop.

## 0.14.3

### Patch Changes

- 740bca9: ux(extensions sidebar): trim the section header's right padding from `pr-24` to `pr-20`. The previous value reserved space for icons that were since removed; the new value lines up cleanly with the action buttons that are actually rendered.

## 0.14.2

### Patch Changes

- 704951d: Agent run-store: stop the bug that caused the user-facing `run_terminal_event_missing` error from happening in the first place. The reaper paths (`reapIfStale`, `reapAllStaleRuns`, `cleanupOldRuns`, `markRunAborted`) used to call `appendTerminalRunEvent(...).catch(() => {})`, silently dropping transient SQL errors and stranding reconnecting clients with bare `status='errored'` rows. They now go through `safeAppendTerminalRunEvent` — one retry after a 100ms backoff, then a structured `captureError` to Sentry on persistent failure. `cleanupOldRuns` also broadens its terminal-event-append SELECT to cover the 24h-age UPDATE in addition to the heartbeat-stale one (an old run with a somehow-fresh heartbeat would previously be flipped to `errored` without a terminal event).
- 704951d: Return Builder desktop Google sign-in to the local workspace gateway and bridge the OAuth session back with `_session`.
- 704951d: Stop chat history from "reverting" mid-conversation: `useChatThreads.fetchThreads` now reconciles per-thread instead of replacing wholesale, so a server fetch that arrives a few hundred ms behind a fresh local update no longer rolls the recent-chats list back to older timestamps. The active thread is also kept visible in the History popover (and highlighted as `Active`) even when its `messageCount` is still zero, so a brand-new chat doesn't appear to vanish from the list right after opening.
- 704951d: fix(chat): stop creating empty `chat_threads` rows on every page mount + recover from stale active threads

  Two related fixes that together prevent `chat_threads` from filling up with ghost rows and prevent users from getting stuck on an active id the server doesn't know about:
  - `useChatThreads` no longer optimistically `POST`s `/_agent-native/agent-chat/threads` when synthesizing a thread id for the composer. The previous flow inserted an empty `chat_threads` row (`message_count=0`, no linked `agent_runs`) on every page mount and every "+" click, even when the user never sent a message. The agent run's server-side `persistSubmittedUserMessage` already creates the row idempotently the moment the user sends, so the client just adds the thread to local state. Rows now land in `chat_threads` only when there's a real conversation behind them.
  - When the saved active thread id isn't on the server AND wasn't created locally this session, the hook now drops the user on the most-recent real thread instead of leaving them on a stale composer that the server has no record of. The `newlyCreatedRef` check disambiguates: only optimistic-this-session ids stay active; ids from a previous session whose row was cleaned up get swapped out.

  Per-thread merge in `fetchThreads` (already shipped) keeps in-flight optimistic threads visible until the server learns about them, so the chat list still shows the user's current thread without flicker.

- 704951d: Two small UI primitives:
  - Prompt composer: click an attached image to open a fullscreen preview (Esc / click-outside to close). The thumbnail's X button still removes.
  - Agent sidebar: new `window.dispatchEvent(new Event("agent-panel:close"))` event mirrors the existing `agent-panel:open` so apps can collapse the sidebar programmatically (used by the design template's Edit mode to free up canvas space).

- 704951d: Agent SSE reconnect: replace the cryptic `run_terminal_event_missing` error with the friendlier stale-run message, and persist it back to SQL so future reconnects replay the proper terminal event instead of regenerating it. This path triggers when an `agent_runs` row was flipped to `errored` but the terminal event write was lost (e.g. a reaper's `appendTerminalRunEvent(...).catch(() => {})` swallowed a transient DB error). The user-facing situation is identical to a stale-run reap, so the UI now shows "The agent stopped before it could finish" with `recoverable: true` (offering retry) instead of the debug-string error.

## 0.14.1

### Patch Changes

- 513aac1: fix(chat): recover from chats disappearing from sidebar history

  Two changes that together restore the pre-#621 behavior where the chat history list always reflects the server:
  - **client**: Stop hydrating chat messages from a per-thread `localStorage` cache, and stop synthesizing a fresh UUID active thread inside the `useState` initializer. The cache could mask stale or partially-saved threads, and the synthesized id raced with the agent run's server-side `persistSubmittedUserMessage` create — when the client's `POST /threads` then lost the race, its `.catch` was yanking the freshly-created thread out of local state. Active thread is now resolved against the server's threads list (most-recent fallback if the saved id isn't there); thread messages are loaded from the server. The `agent-chat-active-thread` localStorage key still persists which thread the user last had focused.
  - **server**: Make `POST /_agent-native/agent-chat/threads` idempotent. When the request body's `id` matches an existing thread owned by the same user, return that thread instead of failing on the SQL UNIQUE constraint. This also means a flaky network retry of `POST /threads` no longer 500s after the agent's `onRunPrepared` already inserted the row.

- 513aac1: refactor(agent): extract `runAgentLoopDirectWithSoftTimeout` (the soft-timeout + resumable-error continuation wrapper) out of `agent-chat-plugin.ts` into a dedicated `run-loop-with-resume.ts`, with unit and integration spec coverage for the soft-timeout path, gateway-timeout resume, network-interrupt resume, the `MAX_RUN_LOOP_CONTINUATIONS=6` cap, and upstream-abort handling.

  Also bumps `DEFAULT_BUILDER_GATEWAY_TIMEOUT_MS` from 45s to the existing 55s cap so design generation and other long-output workloads get the full per-call budget Lambda's 75s function limit allows. 55s leaves ~20s headroom for response streaming + the soft-timeout continuation path.

## 0.14.0

### Minor Changes

- 04fe544: feat(agent): resume runs that get cut off by upstream gateway timeouts (Builder gateway, HTTP 502/503/504, serverless function timeouts) or transport-level interruptions (socket hang up, ECONNRESET, fetch failed, stream closed) instead of failing the run.

  The `auto_continue` event's `reason` union picks up two new values — `gateway_timeout` and `network_interrupted` — so clients can show a precise message. Internally the agent gets a one-line continuation note describing how it was interrupted, then resumes from the same conversation prefix (Anthropic prompt cache rescues the latency) and finishes the user's original request without redoing completed work.

- 04fe544: feat(auth): when `COOKIE_DOMAIN` is set (e.g. `.agent-native.com` for first-party deploys where each app is its own subdomain), the framework session cookie is shared across every subdomain. The cookie name becomes the unsuffixed `an_session` and a `Domain=<COOKIE_DOMAIN>` attribute is added on every set/clear, so signing into one app signs the user into every sibling app under the same parent domain.

  Better Auth's session cookie picks up the same domain via its `crossSubDomainCookies` advanced option, so its cookie and the legacy framework cookie stay in sync across subdomains.

  Falls back to the existing per-app and workspace-mode cookie naming when `COOKIE_DOMAIN` is unset, so non-first-party deploys keep their origin-scoped cookies.

- 04fe544: feat(extensions/fetch-tool): the `web-request` tool now sends realistic Chrome-on-macOS headers (User-Agent, Accept, Sec-Fetch-\*, Upgrade-Insecure-Requests, etc.) by default so sites with anti-bot middleware (Cloudflare, PerimeterX, Akamai) respond normally instead of returning challenge pages. Caller-supplied headers always win, so API calls with Authorization keep their values untouched.

  Also raise the response truncation cap from 8k to 32k chars so the agent can read a full article or scraped table in one shot.

- 04fe544: feat(onboarding): pick Google sign-in flow with `GOOGLE_AUTH_MODE` env var (`auto` | `popup` | `redirect`, default `auto`). Auto uses a popup in normal browsers, a full-page redirect inside Electron, and a popup inside the Builder.io browser iframe (Google rejects framing). The new `resolveGoogleAuthMode()` server helper is also exported from `@agent-native/core/server/google-auth-mode` for callers that need to pass an explicit mode.

### Patch Changes

- 04fe544: Auto-send the user's pending prompt the moment Builder.io connection
  completes. The Connect Builder card carries the user's original ask as
  its `prompt` prop; previously the OAuth popup closing left them staring
  at a "Send to Builder" button as if they had to retype it. The card now
  fires the send automatically once `connecting` flips false with a
  configured Builder, but only if the user actually clicked Connect this
  session — revisiting an already-connected card still requires an
  explicit click so old threads don't replay on re-open.
- 04fe544: fix(agent prompt): two routing tweaks for connect-builder.
  - Add an "Extensions vs. Code Changes — Pick the Right Path" section so the agent prefers `create-extension` for new self-contained surfaces (widgets, dashboards, lists, viewers) and only falls back to `connect-builder` when the request modifies the host app's existing chrome.
  - Make the agent briefly acknowledge the user's specific ask before handing off to Builder, and reword the post-card sentence around what the user just asked for instead of leading with a generic Builder pitch.

- 04fe544: - db/neon: Attach a logging error listener to the Neon serverless Pool. Without one, Node 24 surfaces routine WebSocket drops (idle timeout, Lambda suspend, network blip) as fatal `Unhandled error` / `Connection terminated unexpectedly` uncaught exceptions even though the next query would have transparently reconnected. The pool now logs and swallows these so they don't crash the function or fill Sentry.
  - server/sentry: Drop 4xx HTTPError / H3Error from `beforeSend`. h3's `createError({ statusCode: 4xx })` is the documented way to return 404 / 400 / 401 from a route — those bubble through Nitro's error hook and were getting captured as Sentry issues. Match by statusCode when present, fall back to message heuristics ("not found", "Cannot find any route matching", "No access to …", "Unauthenticated") so handler-thrown 4xx don't bury real bugs.
- 04fe544: fix: avoid spurious failures in two edge cases.
  - `agent_run_events` writes now use `ON CONFLICT (run_id, seq) DO NOTHING` so a `pendingTerminalEvent`-reserved seq getting reused, or `appendTerminalRunEvent` racing with the producer's final event, no longer leaves the run in an inconsistent terminal state.
  - `fetchPollJson` in `use-db-sync` now awaits `res.json()` inside the `try` before the timeout `finally` runs, so a body-stream abort can't escape as an unhandled rejection.

- 04fe544: - AssistantChat: clearer Builder-setup card copy ("Turn on the AI assistant" / "One click to connect Builder for free hosted access — no API keys needed").
  - Sentry: drop `AgentAutoContinueSignal` (control-flow sentinel) on the browser side and `ForbiddenError` / `UnauthorizedError` on the server side from captured events. They aren't real failures and were burying actionable bugs in the Sentry issue list.
- 04fe544: ux(agent prompt): after finishing a task with obvious recurring value (daily triage, weekly digests, monthly cleanup), the agent now offers to save it as a recurring job in one short closing line, then calls `manage-jobs(create)` if the user confirms. Skips the offer for one-shot lookups, single drafts/replies, and prompts that already specify a cadence.
- 04fe544: fix(dispatch): make the `/dispatch/<appId>` server-side bounce work in production deploys and after live workspace changes by reading the same env-→file-→filesystem manifest fallback chain that the rest of agent discovery uses, instead of only checking `AGENT_NATIVE_WORKSPACE_APPS_JSON`.

  Core now exports `loadWorkspaceAppsManifest()` and the `WorkspaceAppManifestEntry` type from `@agent-native/core/server/agent-discovery`, so other server entrypoints can resolve the workspace manifest without re-implementing the fallback.

- 04fe544: Strengthen the `create-extension` tool description so the agent generates more
  robust extensions: prefer `<script>` + `Alpine.data('name', () => ({...}))`
  for any non-trivial component instead of stuffing methods, branching, and
  template literals into an inline `x-data="..."` attribute (HTML parser
  pitfalls cause `ReferenceError` failures); require a real LLM key via
  `${keys.*}` for AI features or route the AI work to the agent chat instead
  of shipping a stubbed analysis step.
- 04fe544: Fix Extensions sidebar header so the info-circle icon no longer overlaps the title text on narrow widths. Title now truncates cleanly and the info button only appears on row hover.
- 04fe544: fix(auth): share the framework session cookie across all apps in workspace mode + add `Partitioned` to the cookie attributes so it survives Builder.io's iframe + Chrome's third-party-cookie deprecation.

  Two related issues were combining to break workspace SSO:
  1. The framework cookie name was suffixed with `APP_NAME` (`an_session_dispatch`, `an_session_todo`, etc.) to prevent template ping-ponging in `dev:all`. In workspace mode every app shares the same origin **and** the same DB, so per-app suffixes were the wrong default and killed cross-app sign-in. Workspace apps now share `an_session_workspace`.
  2. The framework cookie was set with `SameSite=None; Secure` but no `Partitioned` attribute, so the Builder OAuth popup → main-iframe handoff dropped the cookie under Chrome's third-party storage partitioning. Better Auth's own cookie already has `Partitioned: true`; this brings the framework's legacy cookie in line.

  After this change, signing into one workspace app (Dispatch in builder-workspace) means you're signed in across the workspace's other apps too, and the agent chat sidebar's auth check stops looping back to the login page on subsequent app loads.

## 0.13.1

### Patch Changes

- 051fcac: Swap `AgentPresenceChip`, `PresenceBar`, and `agent-identity` accent colors to the agent-native brand blues (#00B5FF / #48FFE4) so presence indicators match the new analytics chart palette.
- 051fcac: Route Builder desktop Google sign-in through the configured public OAuth origin so the centralized callback host mints and redeems the OAuth state.

## 0.13.0

### Minor Changes

- 98d56cd: Surface a user-visible "this chat looks stuck" affordance when an agent run goes silent. The server now tracks a durable `last_progress_at` timestamp on every emitted event (distinct from the process-liveness `heartbeat_at`); `/runs/active` returns it; and a new `useRunStuckDetection` hook + `RunStuckBanner` component poll it from the client. After 90s without progress — past the adapter's 75s no-progress reconnect — the banner appears with Retry / Cancel buttons. `MultiTabAssistantChat` wires this in by default, with Retry sending a continuation prompt via the existing chat handle. `trackEvent` calls fire on stuck-detected, retry, and cancel so we can finally see the long tail of stuck-chat incidents in analytics instead of relying on user reports.

### Patch Changes

- 98d56cd: Make the chat sidebar paint instantly on open instead of blocking behind network round-trips. `useChatThreads` now seeds an optimistic active thread synchronously on mount — either from localStorage or a freshly-generated UUID — and persists it server-side in the background. For existing chats, every save also writes the thread data to a localStorage cache, and `AssistantChat` hydrates from that cache synchronously so the message bubbles paint on first commit; the server fetch still runs in the background to refresh, and is skipped as a no-op when the server data is identical to the cache.
- 98d56cd: Composer + menu now reads "Create Extension" (was "Create Tool") and "Schedule Task" (was "Scheduled Task") to match the imperative tense of the other menu items.
- 98d56cd: Reword waitlisted Builder Cloud Agents UI from "unavailable" to "coming soon" in the connect card and code-required dialog.

## 0.12.40

### Patch Changes

- dd3090e: When the agent chat is open in a plain browser tab on localhost, source-code work via the dev handler kills the chat session — Vite HMR and full page reloads cancel the in-flight run. The chat adapter now sends `x-agent-native-surface: desktop | frame | browser`, and the server forces the prod handler (no shell / no fs) on the chat-in-browser-on-localdev surface and prepends a redirect block telling the agent to point users at Agent Native Desktop, Claude Code, Codex, or Builder.io for code changes instead of trying to edit source itself.

## 0.12.39

### Patch Changes

- e4f6cf3: Workspace dev gateway pages (loading + index) now respect `prefers-color-scheme` and render in dark mode when the user's OS is set to dark.
- e4f6cf3: Prefer the public auth origin (`APP_URL` / `BETTER_AUTH_URL` / `WORKSPACE_OAUTH_ORIGIN`) over the workspace gateway URL when resolving Google OAuth redirect URIs, on both server and client. Filter out loopback gateway origins so dev workspaces don't accidentally redirect to localhost in production. The workspace dev runner forwards the resolved origin to per-app processes via `VITE_WORKSPACE_OAUTH_ORIGIN`.

## 0.12.38

### Patch Changes

- cd451f8: Clarify Builder Cloud Agent waitlist copy and desktop fallback links.

## 0.12.37

### Patch Changes

- 10d8f30: Keep workspace Google OAuth redirects on the configured gateway callback instead of Builder preview origins.
- 10d8f30: Restore the chat-with-dots Tabler icon for the shared agent sidebar toggle.
- 10d8f30: Fix user-testing bugs around unavailable CLI controls, desktop Builder connect fallback, missing-LLM guidance, and duplicate chat activity step keys. Also adds quieter capability cues for code/Builder availability and integration setup prerequisites.
- 10d8f30: Keep chat connected to active server runs when the local runtime drops idle unexpectedly.
- 10d8f30: Add a Dispatch thread debugger with cross-source thread search and deep agent run inspection.

## 0.12.36

### Patch Changes

- bc8311a: Tighten the extensions empty-state copy ("Describe a small app and the agent will build it.").

## 0.12.35

### Patch Changes

- b209def: Make raw agent database tools fail closed for tables without a recognized tenant scope.
- b209def: Polish the extensions empty state hierarchy and composer alignment.

## 0.12.34

### Patch Changes

- d749754: Drop the command menu from `top-[5vh]` to `top-[15vh]` so the palette sits comfortably below the page header instead of pinned to the top.
- d749754: Top-align command palettes so result count changes do not shift their viewport position.

## 0.12.33

### Patch Changes

- 9e11b24: Drop the command menu from `top-[5vh]` to `top-[15vh]` so the palette sits comfortably below the page header instead of pinned to the top.
- 9e11b24: Top-align command palettes so result count changes do not shift their viewport position.

## 0.12.32

### Patch Changes

- 8a83abd: Use redirect sign-in inside Builder.io desktop and harden Builder Google popup opening.
- 8a83abd: Move the extensions sidebar explainer from a click popover to an interactive hovercard.

## 0.12.31

### Patch Changes

- 88f206f: Open workspace settings to the relevant settings section and update chat history wording.
- 88f206f: Extract the QuestionFlow primitive from the design / videos / slides templates into a shared `GuidedQuestionFlow` (plus `useGuidedQuestionFlow` hook and helpers `formatGuidedAnswerValue`, `formatGuidedAnswersForAgent`, `getOtherGuidedAnswerText`, `hasGuidedAnswer`, `isOtherGuidedAnswer`, `makeOtherGuidedAnswer`, `normalizeGuidedAnswers`). Templates that need question-driven generation can now consume the same component instead of forking ~400 lines of UI each.
- 88f206f: Improve agent chat tool-call detail display and disable lazy route-discovery manifest polling in template configs.
- 88f206f: Stamp `requestMode` on every assistant chunk's metadata so the chat surface can tell which mode each turn was actually generated under. The Plan-mode "Implement Plan" CTA now requires the latest assistant message to be a plan response, instead of triggering on any assistant message while the global toggle is plan. Also let the chat history popover include currently-open tabs (marked "Open" instead of a timestamp) so users see their full thread list.
- 88f206f: Prevent copying public-only share links before the resource is public.
- 88f206f: Await persistence of terminal run events before writing the final run status, and skip the status update if the terminal-event SQL write fails — so reconnects can no longer observe `status='errored'` without the corresponding error payload, and the heartbeat-stale reaper retries the run cleanly. Also forces the settings panel to re-apply `initialSection` when the same value is requested twice via a new `sectionRequestKey` prop, and updates the dev overlay shortcut hint to render `Cmd+Ctrl+A` on Mac and `Ctrl+Alt+A` elsewhere.
- 88f206f: Add an optional `id` prop on `SettingsSection` so callers can deep-link or scroll to a specific section. The `agent-panel:open-settings` CustomEvent now accepts an optional `detail.section` field that AgentPanel forwards to the settings panel as `initialSection`. Rename the chat-history toggle copy to "All chats".
- 88f206f: Persist terminal agent-run events before final run status updates so reconnects replay the real outcome.
- 88f206f: Stream `/_agent-native/events` SSE for in-process change events as the fast path for `useDbSync`, with the existing `/_agent-native/poll` endpoint as the cross-process / serverless fallback. When the SSE stream is connected, the polling interval relaxes to 15 s; if the server can't reach the client (or the consumer passes `sseUrl: false`), polling continues at the original cadence. Tool-call cards in `AssistantChat` now expose copy-to-clipboard buttons on the input and result panes.
- 88f206f: Open the agent settings panel when selecting Workspace settings from the organization switcher.

## 0.12.30

### Patch Changes

- 419988f: Surface a visible "model returned an empty response" message when an engine ends a turn with reasoning-only content and zero output text (e.g. OpenAI gpt-5+ Responses runs where reasoning consumes the entire output-token budget). Previously the SSE stream finished cleanly with no text, producing a silent empty assistant bubble.
- 419988f: Add an optional `prepareRequest` hook on `ProductionAgentOptions` and `AgentChatPluginOptions` so templates can normalize the inbound chat request — materialize uploaded attachments into per-template file handles, rewrite the message, or append non-visible instructions — between owner resolution and system/context assembly. Re-export `AgentChatAttachment` from the core entry points so templates can type the hook's payload.
- 419988f: Add a server-side agent chat request preparation hook for templates to materialize uploaded attachments before a run starts.

## 0.12.29

### Patch Changes

- 4c90b33: Use Claude Sonnet as the default Builder gateway chat model.

## 0.12.28

### Patch Changes

- fd1cc43: Add Google OAuth handoff debug breadcrumbs for Builder-hosted sign-in flows.
- fd1cc43: Pause `useDbSync`, `useScreenRefreshKey`, `usePausingInterval`, and `useCollaborativeDoc` polling while the tab is hidden so background tabs do not keep waking the network. Restores polling on focus and visibility change. The new `pauseWhenHidden` option defaults to `true`; pass `false` to keep the legacy always-on behaviour. Also expand `useDbSync`'s default invalidation set to include `app-state`, `navigate-command`, `show-questions`, and `__set_url__`, so framework-managed application-state keys stay in sync without templates having to opt in by passing `queryKeys`. The `/_agent-native/poll` endpoint now subscribes to in-process `app-state` and `settings` emitters and records changes directly, skipping a DB scan when the event happened on the same Node instance, and forwards an `owner` field on every event so clients can match it to the active session.
- fd1cc43: Allow per-message plan/act override via `runConfig.custom.requestMode` so the chat composer can flip a single user turn into Implement Plan without changing the global Plan/Act toggle.

## 0.12.27

### Patch Changes

- 08d4113: Broaden composer upload filters so Markdown, JSON, CSV, DOCX, and PPTX reference files are selectable in native file pickers.
- 08d4113: Buffer streamed assistant text until the final-response guard approves it, so rejected answers never flash before the corrective retry. Removes the `clear` event the UI used to swallow.
- 08d4113: Improve assistant chat embed previews and sub-agent task card labels.
- 08d4113: Clear stale chat activity when corrective agent retries discard partial output.
- 08d4113: Add Preview header bar to IframeEmbed showing the embed's title above the iframe.
- c195ddd: Include installed libsql native packages in Node serverless bundles so hosted apps do not fail loading local SQLite/libsql fallbacks.
- 08d4113: Use better-sqlite3 for local SQLite file URLs and `@libsql/client/web` for remote libsql/Turso URLs so serverless bundles no longer depend on libsql's platform-specific native packages. The deploy bundler still copies any installed `@libsql/<platform>` natives into Netlify/Vercel/Lambda outputs as a safety net.
- 08d4113: Bundle agent chat feedback controls with the main client entry so missing lazy chunks cannot crash the agent panel.
- 08d4113: Show visible assistant error text for chat authentication failures instead of blank messages.

## 0.12.26

### Patch Changes

- 09d9748: Bundle agent chat feedback controls with the main client entry so missing lazy chunks cannot crash the agent panel.

## 0.12.25

### Patch Changes

- 1155964: Close Google OAuth success popups after Builder workspace sign-in completes.
- 1155964: Keep hosted chat credential isolation intact and show visible missing-credential errors.
- 1155964: Read legacy workspace-scoped Builder credentials so users who connected before org scoping no longer see "missing key" errors.

## 0.12.24

### Patch Changes

- d198100: Polish setup, navigation, editor, and feedback affordances from user feedback.
- d198100: Preserve chat attachments and completed history during interrupted-run recovery.
- d198100: Fix stale collaboration presence cleanup, stale run handling, and agent panel recovery.

## 0.12.23

### Patch Changes

- e752afd: Expire stale progress runs so abandoned tray indicators do not stay active forever.
- e752afd: Require request-scoped Builder or LLM credentials for signed-in users on hosted shared-database apps.
- e752afd: Use neutral composer styling when Plan mode is active.
- e752afd: Contain failed remote MCP handshakes and show concise connection errors.
- e752afd: Quiet the optional node-pty missing notice unless terminal debug logging is enabled.
- e752afd: Keep the Workspace docs tooltip from overlapping the panel header.
- e752afd: Improve Sentry signal for Builder gateway network failures and browser analytics noise.
- e752afd: Use the request-context owner when resolving explicit agent engine credentials.
- e752afd: Preserve uploaded attachments on queued chat messages and stringify screen context objects.

## 0.12.22

### Patch Changes

- 1ba9738: Allow composer dictation to request same-origin microphone access and improve blocked-microphone guidance.
- 1ba9738: Use the AI SDK's default OpenAI Responses path for first-party OpenAI agent models.
- 1ba9738: Show a Builder reconnect action when agent chat hits Builder or model-provider auth errors.

## 0.12.21

### Patch Changes

- 0d95d53: Restore production Plan mode in the agent sidebar and clarify read-only planning before production writes.
- 0d95d53: Fix prompt composer model selection in embedded prompt dialogs.
- 0d95d53: Add generic client/server error capture helpers and report agent chat run failures through configured capture providers.

## 0.12.20

### Patch Changes

- 715eda8: Fix sidebar popover clipping, terminal startup visibility, automation test routing, and tiny usage rounding.
- 715eda8: Add Vercel workspace deploy packaging and make the shared-token login gate provider-neutral.
- 715eda8: Reduce noisy CLI Sentry reports for handled workspace watcher limits and skip first-party agent symlinks during GitHub tarball extraction on Windows.
- 715eda8: Collect browser and server Sentry errors from shared DSN deploy configuration.
- 715eda8: Add `vercel` as a third workspace-deploy preset alongside `cloudflare_pages` and `netlify`. When `preset=vercel`, the build emits into `.vercel/output` so the standard Vercel build pipeline picks it up unmodified.

## 0.12.19

### Patch Changes

- 3b88628: Disable Plan mode in local browser dev surfaces and point users to Agent Native Desktop for planning.
- 3b88628: Use cross-site session cookie attributes for Google OAuth sessions so embedded app chat remains authenticated.
- 3b88628: Default the framework to the Builder gateway's `gpt-5-5` model alias, centralize built-in engine model defaults/catalogs in `model-config.ts`, and stop hard-coding `DEFAULT_MODEL` for A2A / MCP / integrations runs — the resolved engine's default is used instead. Also adds a "Use Builder" cloud CTA alongside the Desktop CTA in the AgentPanel and CodeRequiredDialog code-access-unavailable surfaces, including a `useBuilderConnectUrl()` hook that wires up the secondary link from `/_agent-native/builder/status`.
- 3b88628: Fix lazy workspace dev root routing, live app discovery, and generated app dependency startup.
- 3b88628: Keep oversized pasted-text chat attachments from overflowing agent context and render them consistently as pasted-text chips.

## 0.12.18

### Patch Changes

- c17f651: Reorder agent-engine resolution so a Builder-connected user always wins over a stale settings row. Add `isStoredEngineUsableForRequest` so per-user `app_secrets` (Builder or BYOK) are recognized when deciding whether a stored engine is usable, and update `/agent-engine/status` and the engine picker to honor the same priority chain at request time.
- c17f651: Polish OAuth callback close-tab success and error page spacing.

## 0.12.17

### Patch Changes

- ad7006d: Block frame-routed code submissions when local source access is unavailable and point users to Agent Native Desktop for code, CLI, and Workspace access.
- ad7006d: Keep workspace app creation prompts editable after submit and clarify that named products are design references, not implied API-key requirements.
- ad7006d: Fix Plan mode selector mouse interaction and remove keyboard-shortcut wording from user-facing mode guidance.
- ad7006d: Suppress benign Vite connection-reset error overlays and keep narrow composer controls contained.

## 0.12.16

### Patch Changes

- 27c3dbc: Submit a pending email invite when closing the share popover with Done.
- 27c3dbc: Clarify provider-specific tool routing so named external sources win over generic warehouse tools.
- 27c3dbc: Improve chat run completion durability and clarify mounted workspace app routing.
- 27c3dbc: Preserve public forwarded host/protocol headers when proxying workspace apps so Google OAuth redirect URIs use the stable gateway origin instead of internal app dev ports.

## 0.12.15

### Patch Changes

- b07f933: Export the Builder agent engine for template media pipelines.
- b07f933: Clarify workspace app creation instructions to reuse hosted first-party apps as A2A neighbors instead of cloning or nesting templates.
- b07f933: Make extension removal handle shared extensions and refresh installed widgets cleanly.

## 0.12.14

### Patch Changes

- 5115f28: Add Dispatch knowledge packs to workspace resources and let new-app flows grant them alongside vault keys.
- 5115f28: Add an optional run-local command CTA to auth marketing pages.
- 5115f28: Retry workspace app dev servers after early launch failures during local app creation.

## 0.12.13

### Patch Changes

- b1595cc: Allow Builder Connect to override deploy-level Builder credentials with request-scoped credentials.
- b1595cc: Improve Builder transcription error detail and remove OpenAI-specific fallback guidance.

## 0.12.12

### Patch Changes

- 4caaa4f: Keep workspace app creation on same-origin gateway routes and stop child dev servers from advertising private ports.
- 4caaa4f: Give the extensions empty state more breathing room.

## 0.12.11

### Patch Changes

- e076977: Hide the share dialog notification checkbox until an email invite is entered.
- e076977: Match the share popover and trigger surfaces to app sidebar backgrounds.
- e076977: Surface tool-input progress in agent chat and recover from stale reconnect streams.
- e076977: Make generated workspace apps preserve their mounted base path and keep Dispatch app links on the active workspace gateway origin.
- e076977: Support stable root OAuth callbacks for path-mounted workspace apps and clarify new-app prompts.

## 0.12.10

### Patch Changes

- f0776fc: Decode extension route path segments so extensionData removal works for item IDs with spaces.
- f0776fc: Keep short pasted text inline in the agent composer and only convert page-sized pastes to attachments.
- f0776fc: Keep agent chat auth prompts scoped to the originating chat and surface streamed provider auth errors as run errors.
- f0776fc: Preserve structured tool history across agent chat recovery turns and suppress duplicate read-only calls during continuations.

## 0.12.9

### Patch Changes

- 7a849c3: Give the shared extensions sidebar header room for its full label and replace the docs icon tooltip with an interactive popover.
- 7a849c3: Include the Images app as a default connected A2A agent and guide agents to use it for generated imagery.
- 7a849c3: Images-template library refactor + agent-discovery polish.
- 7a849c3: Remember extension sidebar usage and add collapsible sort controls.

## 0.12.8

### Patch Changes

- fdf8cfc: Align the agent sidebar toggle button with standard top-bar icon controls.

## 0.12.7

### Patch Changes

- 7d0ebfc: Add Builder-managed image generation onboarding support and endpoint helpers.
- 7d0ebfc: Move Mail lower in template pickers, remove non-featured templates from default selections, and add a hosted Mail Google sign-in notice.
- 7d0ebfc: Preserve standard `backdrop-filter` declarations in production CSS builds.
- 7d0ebfc: Allow share dialogs to customize visibility and link copy for template-specific access wording.

## 0.12.6

### Patch Changes

- 471bf1e: Treat invalid chat session tokens as auth failures and make empty command-menu AI prompts open chat.
- 471bf1e: Show Builder.io LLM usage as agent credit spend when Builder is the active provider.
- 471bf1e: Harden agent chat auth and gateway recovery paths.
- 471bf1e: Keep programmatic new-tab chat sends on the requested thread id so UI callers can track run state.
- 471bf1e: Allow the feedback popover's first submit click to load the form schema before sending.
- 471bf1e: Persist the agent chat model selection across page refreshes.
- 471bf1e: Allow notification bells to show clearer empty-state copy.
- 471bf1e: Add optional share notification controls and direct resource links for sharing emails.

## 0.12.5

### Patch Changes

- 2e99cca: Fix workspace scaffolding for the Design template and clarify local Dispatch setup.
- 2e99cca: Shorten the composer model selector reasoning effort label.
- 2e99cca: Send Builder gateway owner headers from the Builder agent engine and keep Builder auth failures out of the app-login flow.
- 2e99cca: Register the `images` template with `hidden:true` in the CLI catalog. The template directory exists in-flight but is intentionally not surfaced in public template lists yet.

## 0.12.4

### Patch Changes

- e2bce24: Keep the prompt composer TipTap schema minimal to avoid ProseMirror recursion in deployed pages.
- e2bce24: Keep existing extension edits on the update-extension path instead of routing them to Builder code changes.
- e2bce24: Recover dev pages when Vite serves outdated optimized dependency 504 responses.

## 0.12.3

### Patch Changes

- d83d5ec: Recognize Images artifacts in cross-app A2A responses.
- d83d5ec: Improve the shared access-token login page with clearer guidance and visible failure states.

## 0.12.2

### Patch Changes

- b878dd8: `agentNative.chatRunning` event now reflects both true and false transitions of `isRunning`, allowing UI consumers to track agent work state in real time.
- b878dd8: Broadcast agent chat running state when normal runs start or stop, and switch the agent panel back to chat when submitting a visible prompt.

## 0.12.1

### Patch Changes

- 47b8486: Avoid duplicate TipTap link extensions when editors provide custom link behavior.

## 0.12.0

### Minor Changes

- 14f7b63: Add agent-callable extension list, hide, unhide, and delete actions so chat can manage visible extensions without raw SQL.

### Patch Changes

- 14f7b63: Tighten generic chat document uploads and make restored chat threads settle at the bottom after refresh.
- 14f7b63: Collapse the extension sidebar list to three items by default.
- 14f7b63: Clarify personal versus organization MCP server scope guidance in the connection UI.
- 14f7b63: Create extensions with private visibility even when the creator belongs to an organization.

## 0.11.4

### Patch Changes

- 24781d0: Clarify Dispatch new-app instructions so Builder branches scaffold separate workspace apps instead of editing starter.
- 24781d0: Add a template hook for retrying guarded final agent answers before they are shown.
- 24781d0: Match the agent sidebar loading header height to the loaded panel header.

## 0.11.3

### Patch Changes

- 81d5b68: Use the Tabler message-dots icon for the agent sidebar toggle.
- 81d5b68: Keep agent DB tools scoped to owner rows when org context is active and rows have no org id.
- 81d5b68: Suppress automatic stale route-chunk reloads inside the Agent Native desktop app.
- 81d5b68: Harden the public-viewer anonymous-owner resolver: validate Referer origin, require the exact Builder callback path, and discard expired status connect URLs in the embedded settings panel.

## 0.11.2

### Patch Changes

- 8975a96: Allow Builder connect popups to complete from local embedded settings panels by accepting a short-lived signed connect token.
- 8975a96: Polish agent chat menus, icons, and message timestamps.
- 8975a96: Add share-link support to the share button and allow templates to expose read-only anonymous chat and Builder-connect surfaces.

## 0.11.1

### Patch Changes

- 2d52595: Detect Builder preview webviews from builder preview URL markers so code prompts route to Builder chat.
- 2d52595: Use the shadcn popover animation for the framework share control and keep visibility changes fresh after reopening.

## 0.11.0

### Minor Changes

- b4bdd34: Workspace settings reachable from the org switcher in every template, plus admin-vs-member roles, bulk invite (typed list, paste-many, CSV upload) with per-row role selection, and stricter auto-join domain validation (must match the admin's own email domain; free email providers like gmail.com are blocked).
  - `OrgSwitcher` exposes a "Workspace settings" link (configurable via `settingsPath`, default `/team`).
  - `useInviteMember` accepts `{ email, role }`; new `useBulkInviteMembers` and `useChangeMemberRole` hooks.
  - New `PUT /_agent-native/org/members/:email/role` endpoint; only owners can promote/demote admins.
  - `org_invitations` gains a `role` column so invites land at the assigned role on accept.
  - `OrgPendingInvitation` type now includes `role`.
  - New `isFreeEmailProvider` export with a curated blocklist used by `setDomainHandler`.

### Patch Changes

- b4bdd34: Replace custom overflow menu in extensions sidebar with shadcn DropdownMenu (Radix-portaled). Fixes the menu being clipped by the sidebar's stacking context and adds the standard fade/zoom animations.
- b4bdd34: Sign connected-agent A2A mention calls with the current request identity in production.
- b4bdd34: Fix Cloudflare Pages deploy failure with `Cannot require: tty`. Terminal-detection helpers in transitive deps (chalk, picocolors, supports-color, debug, etc.) call `require("tty")` at module init; the bundled-worker require shim now covers `tty`, `readline`, `process`, `console`, `perf_hooks`, and `string_decoder` so those CJS calls resolve to the matching ESM imports instead of throwing at deploy time.
- b4bdd34: Allow actions to stop an agent turn after deterministic provider failures instead of feeding the error back into automatic retries.

## 0.10.0

### Minor Changes

- 721f125: NotificationsBell: clicking a notification with `metadata.link` now navigates to that URL (and marks the notification read). Notifications without a link keep the previous click-to-mark-read-only behavior.

### Patch Changes

- 977af2b: Restyle the Builder connect callback / error pages to match the rest of the framework's UI — Inter font, neutral-zinc palette, and dark/light mode that follows the user's app theme (or `prefers-color-scheme`).
- a562b18: Fix extension table initialization and respect reduced-motion preferences on first-run onboarding backgrounds.
- a562b18: Improve chat stop/error fallback copy and normalize escaped tooltip shortcuts.
- 57b7e0a: Composer accepts file drops directly. Previously, dragging a file (PDF, PPTX, image, etc.) into the prompt composer triggered the browser's default behavior (navigating to the file), even though the "+" button accepted the same file types. The composer now intercepts drops, mirroring the existing paste handler — drag a deck or screenshot in and it attaches like a normal upload.
- 57b7e0a: PromptComposer now inlines small text files (`.txt`, `.md`, `.csv`, `.json`, `.yaml`, etc., plus any `text/*` MIME) into the prompt as `<uploaded-text-file>` blocks instead of only attaching them as binary uploads. Truncates after 60k characters. The original file is still attached as well, so server-side handlers that prefer the binary path keep working.
- 57b7e0a: Resolve org-shared Builder credentials when auto-selecting the chat engine.
- a562b18: Fix queued chat handoff after a run completes and improve multi-invite banner spacing.
- a562b18: Detect Netlify Lambda runtimes for hosted agent soft timeouts and cap repeated stale-run recovery loops.
- a562b18: Fix Vite "Failed to resolve import @tauri-apps/api/core" error in fresh CLI workspaces. The settings panel called `window.__TAURI_INTERNALS__.invoke` directly instead of dynamically importing `@tauri-apps/api/core`, so non-desktop installs no longer crash on the first SPA load.
- 57b7e0a: Wrap shadcn `Tooltip` usages in a `TooltipProvider` so the agent panel and other top-level components don't crash on render. PR #509 swapped native `title` hints for `Tooltip`, but `@radix-ui/react-tooltip@1.2.x` requires a provider ancestor and threw `'Tooltip' must be used within 'TooltipProvider'` on the docs site and any template embedding the agent sidebar.
- 977af2b: Route Dispatch overview prompts to Builder chat in Builder frames and keep the app agent sidebar collapsed there by default.
- a562b18: Improve workspace setup feedback and allow adding the Dispatch workspace app from the CLI.
- a562b18: Fix completed chat runs getting restored as permanently thinking after partial thread saves.
- a562b18: Server-side Sentry now attaches user/org context to more error paths. Failed login/signup attempts capture as `level:warning` with `tags.auth:login|signup` and the attempted email pinned to `user.email` (filtered to skip routine bad-credential noise). Every `runWithRequestContext({ userEmail, orgId, ... })` invocation now also tags Sentry's per-request isolation scope, so action handlers, agent-chat tool re-entries, integration webhook processors, and A2A calls all surface errors under the right user even when no session cookie was attached to the request.
- 57b7e0a: Stop reloading the agent chat after Builder or secret configuration updates.
- 57b7e0a: Initialize Sentry inside the Nitro server so 5xx errors thrown by framework routes, action handlers, and agent-chat streams are reported with per-request user context. Driven by the `SENTRY_SERVER_DSN` env var (no-op when unset). Complements the existing CLI and browser Sentry init points without wiring them together — each maps to a different Sentry project.
- a562b18: Improve shared extension shell navigation, creation guidance, and polling recovery.
- a562b18: Recover automatically from no-detail Builder gateway errors in agent chat.
- 57b7e0a: Unify request-scoped secret resolution to read user → org → workspace rows from `app_secrets` everywhere. Previously, `getOwnerApiKey()`, `resolveSecret()`, voice provider status, transcribe-voice, and Google Realtime each had their own slightly different read order — some only checked the user row, some checked user + org but not workspace. They now all walk the same chain, so an org-shared (or workspace-scoped) key is honored consistently no matter which call site resolves it. Solo (no-org) sessions fall back to a `workspace:solo:<email>` row.

## 0.9.1

### Patch Changes

- 4090a2a: PR #511 follow-up fixes:
  - `/runs/active` now surfaces recently-completed and recently-errored SQL runs (within a 10-minute reconnect window) so the agent-chat adapter can replay synthesized done/error events from the run-events stream instead of retrying the original POST when the producer's in-memory state was already evicted (different serverless isolate). Without this, a POST that failed after the server already accepted and finished the run could re-execute the agent turn and double-apply mutations.
  - `/builder/status` now reads the user's active org via `getOrgContext(event)` and passes the orgId into `runWithRequestContext()` so the status poller resolves org-shared Builder credentials. Previously, an admin's org-scope OAuth result was invisible to every other org member's status poller, leaving the UI showing "not connected" even though chat resolved the credentials correctly.
  - Registered secrets routes now treat `scope: "org"` as a first-class scope: writes and deletes require an active org and an owner/admin role (`canMutateOrgScope`), and `resolveScopeId("org", …)` rejects requests without an active org rather than falling back to a `solo:` scopeId. Ad-hoc secret routes were already restricted to `user`/`workspace` and remain unchanged.

## 0.9.0

### Minor Changes

- 117d476: Builder credentials are now stored at org scope by default when an owner/admin connects, so a single OAuth flow powers AI chat for everyone in that org.
  - New `app_secrets` scope: `"org"` (alongside `"user"` and `"workspace"`).
  - `writeBuilderCredentials(email, creds, { orgId, role })` writes at `scope: "org"` when the connecting user is owner/admin of an active org. Plain members (or users in Personal mode) keep writing at `scope: "user"` so a teammate can never overwrite the org-shared connection. The Builder OAuth callback now passes `orgId`+`role` automatically — existing direct callers without options keep their previous user-scope behaviour.
  - `resolveBuilderCredential` and `resolveSecret` now check user scope first, then fall back to the active org's row. `${env.BUILDER_PRIVATE_KEY}` (deploy-managed mode) still wins over both, unchanged.
  - `deleteBuilderCredentials(email, { orgId, role })` mirrors the connect-side scope decision, so a Disconnect press undoes exactly what the same user's Connect press wrote — no orphaned org-shared rows for owners, no accidental org-wide tear-downs from a member's personal disconnect.
  - Helper `resolveCredentialWriteScope(email, orgId, role)` exposes the scope decision for any future credentials integration that wants the same default-to-org-when-admin behaviour.

  Migration: existing per-user Builder connections from before this change keep working for the connecter — but other org members won't auto-resolve to them. To promote a user-scope connection to org-shared, the owner/admin disconnects and reconnects once in the affected app.

- dca4f6d: Domain-based org join across the framework — three connected changes so a fresh signup whose email matches an existing org's `allowed_domain` lands inside that org without manual steps:
  - **Auto-join on signup.** New `autoJoinDomainMatchingOrgs(email)` helper, called from the Better Auth `user.create.after` hook. Anyone who signs up with an email whose domain matches `organizations.allowed_domain` is added to that org as a `member` immediately, and `active-org-id` is set to it (only when the user doesn't already have an active org from a pending invite). Idempotent and missing-table-safe.
  - **OrgSwitcher popover** now renders a "Join your team" section listing every domain-match org with a one-click Join button, for users who signed up before the org existed (or whose auto-join failed). Wires through `useJoinByDomain`.
  - **InvitationBanner** also renders domain-match orgs as a top-of-app prompt, so existing-but-not-yet-joined users see a clear CTA without needing to open the picker.

  The backend (`organizations.allowed_domain`, `getMyOrgHandler.domainMatches`, `joinByDomainHandler`, `useJoinByDomain`) was already in place — these changes wire it into the signup flow and the prominent UIs.

### Patch Changes

- dca4f6d: Improve agent chat setup and auth recovery by routing missing provider setup to Builder.io and surfacing hosted sign-in for authentication failures.
- dca4f6d: Replace native title hints on interactive controls with shadcn tooltips.
- dca4f6d: Resolve agent engine status against the active request user so per-user provider secrets are detected correctly.
- a1fef80: Add [dev-session] log when auto-binding email in CLI runner; fix TS narrowing in db-reset-dev-owner; remove redundant trim in zeroChangesHint.
- 117d476: Harden GitHub design-token imports with token-aware fetch helpers and keep persisted agent run diagnostics longer for reconnect investigation.
- dca4f6d: Keep agent chat auto-recovery alive across long runs that keep making progress.
- dca4f6d: Dedupe collaborative presence avatars by email and show collaborator emails on hover.
- dca4f6d: Smooth signup email verification handoff back into the app.

## 0.8.2

### Patch Changes

- 3424455: Fix `agent-native create` failing with "Unrecognized archive format" on freshly published versions. The CLI now tries the changesets per-package tag (`@agent-native/core@<version>`) first, falls back to the legacy `v<version>` tag, and finally to `main` — so it keeps working through the release-tag scheme shift introduced when the framework adopted changesets.
- 81005c4: Add an optional AgentPanel chat notice render slot.
- 81005c4: Export a reusable client theme initialization script helper.
- 81005c4: Avoid stale Vite prebundles for core source aliases in monorepo development.
- 81005c4: Initialize template light/dark classes before hydration and normalize legacy theme storage.

## 0.8.1

### Patch Changes

- e3a8798: Recover agent chat runs automatically when streams time out, disconnect, or stay open without producing progress.

## 0.8.0

### Minor Changes

- e375642: Add `@agent-native/core/usage` subpath export for `getUsageSummary` so server-side consumers (Cloudflare Workers / Pages) can import it without hitting the curated browser entry. Switch dispatch's usage-metrics store to the new subpath, fixing the dispatch CF Pages build failure.

### Patch Changes

- bcb2069: Hide partial assistant text from transient agent-chat continuations while retaining it as continuation history.
  Recover agent chat streams that stay connected but stop producing progress events.

## 0.7.85

### Patch Changes

- 4e3631b: Add `publishConfig.provenance: true` so `pnpm publish` (called by `changeset publish` from the auto-publish workflow) requests an OIDC token from GitHub Actions and publishes via npm trusted publisher. Without this, `pnpm publish` looked for token-based auth and failed with `ENEEDAUTH`.

## 0.7.84

### Patch Changes

- a75a89c: In Builder.io's editor frame, `sendToAgentChat` now keeps content prompts self-targeted so the embedded app's own `AgentSidebar` receives them. Code requests still delegate to Builder via `builder.submitChat`. Drops the explicit `isInBuilderFrame()` branching from dispatch's home composer — the routing now lives in core.
- a75a89c: Add Dispatch workspace usage metrics and preserve app ids in token usage rows.
- a75a89c: Recommend Dispatch more clearly during workspace scaffolding and add a packaged Dispatch extension API for workspace-owned tabs.
- a75a89c: Add server-side 302 redirect from `/tools` and `/tools/:id` page routes to `/extensions/...` so existing bookmarks for the renamed primitive keep working. Honors `APP_BASE_PATH` for workspace deployments.
