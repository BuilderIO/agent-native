# Multi-Frontier proof record

## Phase 0 installed-runtime gate

Verified on macOS arm64 on 2026-07-19.

```sh
corepack pnpm --dir packages/desktop-app build
corepack pnpm --dir packages/desktop-app exec electron-builder --mac --dir --config
corepack pnpm --dir packages/desktop-app smoke:packaged-code-runner
```

The smoke command copies the packaged `Agent Native.app` into a fresh temporary
root, removes `AGENT_NATIVE_FRAMEWORK_ROOT`, limits `PATH` to system binaries
and a hermetic fake Codex executable, and invokes the runner from
`app.asar/out/main/code-agent-runner-entry.js` through the packaged Electron
binary with `ELECTRON_RUN_AS_NODE=1`.

Recorded result:

```json
{
  "successRunId": "task-20260719163341-e9f745b2",
  "resumedRunId": "task-20260719163344-94c7e6c3",
  "result": "start-cancel-resume-ok"
}
```

The success run persisted `PACKAGED_RUNNER_OK`. The cancellation run forwarded
`SIGTERM` to its Codex child and persisted a readable `paused` event and run
state. Launching the same run again completed with `RESUMED_OK`. The isolated
runtime had no source checkout, `pnpm-workspace.yaml`, `pnpm`, or development
`node_modules`.

The packaged runner currently treats an unavailable workspace MCP native
binding as non-fatal; native Code tools remain available. Workspace MCP support
inside the packaged runner is not proven by this gate.

The same packaged app was then copied into a second isolated root and exercised
through its bundled Multi-Frontier entry:

```sh
corepack pnpm --dir packages/desktop-app smoke:packaged-multi-frontier
```

That entry uses the real manager, coordinator, orchestrator, and local Codex and
Claude adapters. Hermetic fake CLIs expose only the subscription-native login
status and participant protocols; the app receives no API keys. The run reached
the explicit GO gate, completed after a provider-observed `pnpm test` event,
captured a private `0600` checkpoint, canceled a live participant, and recovered
an app-quit-paused collaboration without replaying a provider turn before a new
GO. The recorded run reported 16 provider turns and:

```json
{
  "result": "packaged-multi-frontier-start-go-checkpoint-cancel-recovery-ok"
}
```

Subscription-card rendering and keyboard/accessibility behavior are covered by
the renderer DOM suite described below; provider login and collaboration
lifecycle behavior are additionally proven from the packaged app binary here.

## Phase 0 persistence property ledger

Status as of 2026-07-19 after the Phase 2 coordinator/runtime/IPC commit:

| Property | Status | Evidence and boundary |
| --- | --- | --- |
| Generation fencing and recovery | Proven through the local coordinator and store contract | Multi-Frontier store and coordinator specs reject stale generations and event conflicts, prevent terminal-state regression and failed-driver promotion, and recover interrupted participants as paused, read-only, and lease-revoked. Explicit resume never replays a prior turn. |
| Atomic replacement | Proven for single-writer corruption resistance | Same-directory temporary files are renamed over JSON records and cleanup is tested. The helpers do not call `fsync`; durability through a sudden power loss is explicitly deferred for local desktop v1. |
| Sole-writer ownership | Proven through the local coordinator and durable store boundary | Shared `O_EXCL` arbitration covers Electron and runner-child updates to legacy run records and transcripts. An OS-process test applies eight concurrent record patches without field loss. The committed coordinator accepts only one Codex/Codex CLI and one Claude/Claude Code participant, grants `workspace_write` only to the current fenced driver generation, and serializes state and event mutation. |
| Idempotent event append | Proven across processes for stable ids; legacy caller adoption partial | Concurrent OS processes appending the same stable id produce exactly one Code transcript line and one Multi-Frontier event line. Reused Multi-Frontier ids with different payloads remain conflicts. Most legacy single-agent production callers still generate fresh ids, so retry-level deduplication there remains follow-up work. |
| Bounded Multi-Frontier renderer IPC | Proven for count and serialized bytes | Requests, snapshots, and events are rejected above 64 KiB. Normalized event text is capped at 16 KiB, artifact summaries at 8 KiB, subscription telemetry at eight meters per provider, and subscribe snapshots at 12 artifacts. Live collaboration subscriptions forward one normalized event at a time through the same bounded contract. |
| Additive schema | Proven at library level | The Multi-Frontier record and event schema is additive and isolated from legacy run records. |
| Persisted payload allowlist and retention | Proven for Multi-Frontier coordination artifacts and event tails | Proposal, review, and checkpoint records accept only bounded summary fields, safe file references, hashes, and test summaries. Provider payloads, raw diffs, and account identifiers are not fields in the durable contract. Event journals compact to a bounded contiguous tail with an explicit snapshot-required replay marker; artifacts stop at a per-run cap instead of silently evicting active records. Legacy single-agent records remain outside this new allowlist. |

This ledger intentionally distinguishes a library proof from an installed-app or
multi-process proof. A property does not advance to proven merely because the
supporting API exists.

## Phase 2 coordinator, runtime, and IPC proof

Committed in `6ff7004e5c` (`feat(desktop): add collaboration coordinator`).

The typed Electron contract accepts only bounded, schema-versioned requests for
one Codex and one Claude participant. Renderer snapshots are explicitly
non-authoritative; main revalidates every lifecycle command against the durable
coordinator state. Snapshot normalization permits one active driver and writer
only in `implementing`, requires explicit pending GO before the lease, bounds
artifact/event presentation, and rejects malformed rosters and authority-like
renderer fields.

The subscription projection is identity-free. Account email and organization
fields, raw app-server objects, process environments, and credential-shaped
text are dropped or redacted before IPC serialization. Provider capabilities,
plan, freshness, meters, context, and credits remain available when reported.

The coordinator starts both native adapters read-only, preserves opaque session
references through the durable transition boundary, fences write events by
driver generation, serializes event/status updates, and caps collaboration at
three rounds. Recovery pauses durable work without spawning a child; a resumed
implementation returns to explicit pending GO with a newly fenced driver lease.

Lifecycle regressions are covered with deferred-runner fixtures:

- Cancellation sets a lifecycle fence before child cancellation. A write turn
  held in its durable-start write cannot start after cancellation begins.
- Cancellation waits for an already-started owned runner to settle before it
  persists the terminal state.
- Checkpoint, completion, and failure reject while an implementation turn is
  active, so revoking the lease cannot leave a write-capable child alive.
- Concurrent resume is rejected, and dispose while resume is gated cannot
  resurrect sessions or durable state.

`autoContinueAfterAgreement` is an additive, versioned per-run policy. It
normalizes missing legacy values to `false`, remains opt-in in typed IPC and
renderer presentation, and does not grant a write lease or bypass explicit GO
by default. When enabled, the live orchestrator advances only after it has
persisted agreement, then obtains the same fenced driver lease used by explicit
GO. Consequential planning or checkpoint findings pause before that path;
scope or intent ambiguity, destructive work, security or privacy consequences,
external effects, meaningful cost expansion, and irreversible data or
architecture decisions remain explicit escalations.

Recorded focused verification:

```sh
corepack pnpm --dir packages/core exec vitest run \
  src/cli/multi-frontier-runs.spec.ts
corepack pnpm --dir packages/desktop-app exec vitest run \
  shared/multi-frontier-ipc.spec.ts \
  src/main/multi-frontier-coordinator.spec.ts \
  src/main/multi-frontier-runtime.spec.ts
```

The original committed run recorded 17/17 core and 37/37 Desktop tests passing.
The final verification matrix below supersedes those component-only counts and
includes the packaged installed-runtime smoke.

## Phases 3-5 live orchestration proof

Commits `1c1bcad2d2`, `a332dd8209`, `71b4971c13`, `11801615b7`,
`a87e13c4a7`, `dc93ae29f5`, `a279de70f1`, `a3359be540`, and `0f25107f17`
introduced and hardened the convergence protocol, manager, Electron-main
registration, optional-helper gate, recovery loop, quota admission, lifecycle
command fencing, live subscription updates, and recovery/completion boundaries.
The production path now runs renderer → validated preload/IPC → host → manager
→ real coordinator and orchestrator → subscription-native Codex and Claude
participants. No live path can bypass the convergence rounds, optional GO
policy, driver generation, or checkpoint watchdog.

The real-manager integration covers independent proposals, cross-review,
synthesis, explicit GO and auto-continue, one write-capable driver,
provider-observed test evidence, immutable checkpoint capture, watchdog review,
completion, and restart recovery without replay. Recovered planning prompts are
re-entered through bounded live IPC and never persisted. Reversible checkpoint
findings have an end-to-end `re-review` operation: main selects the exact
undispositioned persisted review, obtains a fresh lease, requires a disposition
for every finding, revokes at a new immutable checkpoint, and invokes the
watchdog again. Consequential findings still pause regardless of auto-continue.
Interrupted proposal, cross-review, and convergence work returns to a fresh
proposal boundary and requires the request to be re-entered. Interrupted
implementation or checkpoint review returns to pending approval. Neither path
replays a provider turn; checkpoint work proceeds only after an explicit
re-review disposition.

Review loops are bounded to three checkpoints per round. Proposal prompts are
tested to exclude sibling proposal content and proposal artifact ids before
cross-review. Artifact text and metadata share the credential redactor before
persistence; fake bearer, `access_token`, `sk_live_`, and token fixtures are
absent from stored artifacts. Synchronous authentication, quota, and provider
failures return a paused authoritative snapshot plus a bounded actionable notice
rather than escaping as an unhandled renderer rejection.

Start, GO, resume, and re-review are mutually fenced per collaboration while
pause and cancel remain interruptible. Concurrent duplicate planning and GO
regressions prove that the duplicate receives a bounded state error without
pausing the valid operation or canceling its active driver.

Completion does not count `git diff --check` as a test. The checkpoint stores
that command as a check, while completion requires at least one successful
test-runner command observed in the provider's structured execution events and
no observed failing test command. Test output is bounded and credential-
redacted before it enters the checkpoint bundle. A regression fixture proves
that even the literal text `Tests 99 passed` from the workspace snapshot cannot
complete a run without the provider-observed marker. Shell-composed commands
such as `pnpm test || true`, `pnpm test; true`, and `pnpm test && true` are not
accepted as trustworthy test evidence even when the outer shell reports zero.

The optional-helper path is implemented as a main-only, read-only gateway with
prompt/artifact/payload limits, depth/task/turn caps, requested and effective
model equality, live provider-quota admission, cancellation, and safe launch
records. Editing is not representable by the gateway. Production delegation is
deliberately unavailable because neither subscription CLI has yet supplied a
provider/runtime proof for a cheap model's effective selection; this is the
fail-closed behavior required by the helper gate, not silent frontier-model
inheritance. The live manager and orchestrator already own the injection,
cancellation, quota, and ordering seams. A provider-proven gateway can therefore
be enabled without changing orchestration semantics, and its bounded review is
included only after independent proposals and cross-review.

## Phase 6 product and privacy proof

The existing new-run composer owns the feature: one compact mode selector,
Codex and Claude subscription cards, and one auto-continue toggle. There is no
wizard or stepper. Live runs use a polite status line, two small role badges,
collapsed evidence, and an existing overflow menu for pause, cancel, safe role
swap, and re-review. Explicit GO is absent under auto-continue. Recovered
planning shows one bounded request field only when it is required.

Codex cards render only provider-reported meters, reset windows, context, and
credits. Claude renders connected plan state and the accepted live-usage-
unavailable explanation. Missing values never render as zero. Keyboard tests
exercise the mode selector and evidence disclosure; focus remains on native or
shadcn controls, phase changes use a polite live region, and menus/dialogs do
not use browser alert/confirm/prompt.

Codex app-server rate-limit notifications now flow through a typed host event,
a second sanitized main-process IPC boundary, the preload subscription envelope,
and the active Code Agents hub. An open usage card updates without a manual
refresh. The host and IPC tests inject account identifiers and prove they are
absent from renderer egress; renderer coverage proves the live percentage is
visible in the usage popover.

Renderer analytics emit only lifecycle categories: mode activation, phase and
round, approval policy, artifact counts, provider connection/capability/
freshness state, action names, and failure class. They do not include a
collaboration id, prompt, diff, artifact content, account identifier, plan
balance, or raw provider payload. Helper launch records follow the same bounded
allowlist.

Cross-process verification command:

```sh
corepack pnpm --dir packages/core exec vitest run \
  src/cli/atomic-json-file.spec.ts \
  src/cli/code-agent-runs.spec.ts \
  src/cli/multi-frontier-runs.spec.ts
```

The lock has a bounded wait, owner-token-checked release, serialized stale-lock
reaping, and dead-PID recovery. A fresh dead-owner fixture proves the durable
path waits through the stale threshold before reclaiming rather than timing out
early. Electron child-event handlers use a separate 50 ms best-effort wait and
contain failures, so a contended persistence lock cannot block for the stale
window or escape into the main-process uncaught-exception path. The helper still
intentionally omits `fsync`; the local-v1 power-loss durability deferral above
is unchanged.

Final repository verification also runs the complete Desktop suite, core
Multi-Frontier/store suites, Code Agents UI tests/typecheck/build, Desktop
typecheck/build, both packaged smokes, oxfmt, and `git diff --check`. Exact
counts and commands are recorded after the final clean run below.

## Final verification matrix

The current hardened bundle was rebuilt and packaged before both installed-app
smokes. The final clean run uses:

```sh
corepack pnpm --dir packages/desktop-app test
corepack pnpm --dir packages/desktop-app typecheck
corepack pnpm --dir packages/core exec vitest run \
  src/cli/atomic-json-file.spec.ts \
  src/cli/code-agent-executor.spec.ts \
  src/cli/code-agent-runs.spec.ts \
  src/cli/code-agent-commands.spec.ts \
  src/cli/multi-frontier-runs.spec.ts \
  src/cli/claude-code-participant.spec.ts \
  src/cli/codex-cli-participant.spec.ts
corepack pnpm --dir packages/core typecheck
corepack pnpm --dir packages/code-agents-ui test
corepack pnpm --dir packages/code-agents-ui typecheck
corepack pnpm --dir packages/code-agents-ui build
corepack pnpm --dir packages/desktop-app build
corepack pnpm --dir packages/desktop-app exec electron-builder --mac --dir --config
corepack pnpm --dir packages/desktop-app smoke:packaged-code-runner
corepack pnpm --dir packages/desktop-app smoke:packaged-multi-frontier
```

The final clean run recorded 20 Desktop files / 191 tests, seven focused core
files / 116 tests, and one Code Agents UI file / two tests. All three typechecks,
the Code Agents UI build, and the Desktop production build passed. Both packaged
smokes passed against the newly built arm64 app; the Multi-Frontier run again
reported 16 provider turns and the success marker above. The source formatting
check covered all changed TypeScript/JSON files in this feature lane, and
`git diff --check` passed.

## Phase 1 provider spike record

Verified on 2026-07-19 against Codex CLI 0.144.3 and Claude Code 2.1.208.

Codex app-server was initialized using its experimental JSON-RPC capability.
A real redacted `account/read` plus `account/rateLimits/read` observation
confirmed ChatGPT plan data, provider windows, model-tier windows, and credits.
The committed fixtures separately pin 10,080-minute duration classification as
weekly, a 34% weekly value, a 0% model-tier value, and credit normalization;
they are not represented as one captured provider payload. The adapter also
handles the `account/rateLimits/updated` notification, process exit, bounded
backoff, signed-out state, and connection-only fallback. It does not read
`~/.codex/auth.json` or rollout files.

CLI version/login probes are asynchronous and output-bounded, so reconnect
checks do not synchronously block Electron main. The long-lived app-server
transport also caps an unterminated stdout frame, rejects pending requests on
transport failure, ignores obsolete-client exits, and closes idempotently.

Claude subscription connection and plan are proven through the documented
`claude auth status --json` command. Live plan-relative meters are not available
to the non-interactive participant runtime: two real `--print` sessions, one in
a fresh temporary workspace and one in the trusted framework checkout, both
completed successfully without invoking a per-session `statusLine` command.
The fixture-fed command itself worked, but that is not live-provider evidence.
Therefore v1 deliberately exposes Claude connection and plan with telemetry
state `unsupported` and the explanation that non-interactive sessions do not
report live plan usage. No status-line sidecar or persisted Claude usage
snapshot ships from this spike. Agent Native does not read Keychain, OAuth
files, private transcripts, or undocumented usage endpoints.

Steve explicitly accepted this Claude v1 degradation on 2026-07-19 after the
bounded status-line spike. The provider capability abstraction remains in
place so a future documented live-usage surface can be added without changing
the collaboration contract.

The normalized provider contract deliberately excludes email and organization
identifiers. They are not persisted, logged, included in collaboration state,
or forwarded through the general Multi-Frontier IPC snapshot. Connection,
subscription plan, capability, freshness, rate-limit, context, and credit data
remain sufficient for the v1 cards and usage popover.

Runtime permission proofs:

- Codex planning/watchdog used `read-only` plus approval `never`; a real write
  attempt created no file. An explicitly leased driver using `workspace-write`
  created the expected file, and an opaque resumed session retained its id.
- Claude watchdog used plan mode with Edit, Write, NotebookEdit, and Bash
  denied; a real write attempt created no file. Its explicit driver created the
  expected file. API-key/provider fallback environment variables are removed
  for both runtimes, and subscription admission is checked before spawn.

Helper record:

| Slice | Requested model | Effective model |
| --- | --- | --- |
| Codex subscription adapter | `gpt-5.6-terra` | Not exposed by worker runtime |
| Claude subscription research and abandoned sidecar spike | `gpt-5.6-terra` | Not exposed by worker runtime |
| Claude participant permission proof | `gpt-5.6-terra` | Not exposed by worker runtime |
| Codex participant permission proof | `gpt-5.6-terra` | `gpt-5.6-terra` |
| Cross-process persistence arbitration | `gpt-5.6-terra` | Not exposed by worker runtime |
| Renderer byte cap | `gpt-5.6-terra` | Not exposed by worker runtime |
| Phase 2 store and artifact contract | `gpt-5.6-terra` | `gpt-5.6-terra` |
| Phase 2 coordinator contract | `gpt-5.6-terra` | `gpt-5.6-terra` |
| Renderer-safe Multi-Frontier IPC contract | `gpt-5.6-terra` | `gpt-5.6-terra` |
| Participant cancellation, env, and stream hardening | `gpt-5.6-terra` | `gpt-5.6-terra` |
| Electron persistence crash containment | `gpt-5.6-terra` | `gpt-5.6-terra` |
| Phase 2 contract audit | `gpt-5.6-terra` | `gpt-5.6-terra` |
| Runtime and IPC wiring map | `gpt-5.6-terra` | `gpt-5.6-terra` |
| Subscription privacy and adapter hardening | `gpt-5.6-terra` | `gpt-5.6-terra` |
| Core durable transition boundary | `gpt-5.6-terra` | `gpt-5.6-terra` |
| Phase 2 lifecycle and resume race review | `gpt-5.6-terra` | `gpt-5.6-terra` |
| Desktop Multi-Frontier workspace UI | `gpt-5.6-terra` | `gpt-5.6-terra` |
| Packet #5 green review | `gpt-5.6-terra` | `gpt-5.6-terra` |
| Live manager and real coordinator integration | `gpt-5.6-terra` | `gpt-5.6-terra` |
| Checkpoint disposition and recovery loop | `gpt-5.6-terra` | `gpt-5.6-terra` |
| Optional read-only helper gateway | `gpt-5.6-terra` | `gpt-5.6-terra` |
| Accessibility and release-gap audit | `gpt-5.6-terra` | Not exposed by worker runtime |
| Phase 3-6 completeness audit | `gpt-5.6-terra` | `gpt-5.6-terra` |
| Final security audit | `gpt-5.6-terra` | `gpt-5.6-terra` |
| Packaged Multi-Frontier smoke | `gpt-5.6-terra` | `gpt-5.6-terra` |
| Packet #7 anti-anchoring and credential regressions | `gpt-5.6-terra` | `gpt-5.6-terra` |
| Live provider-status event and verification matrix | `gpt-5.6-terra` | `gpt-5.6-terra` |
| Lifecycle concurrency fix and final re-audit | `gpt-5.6-terra` | `gpt-5.6-terra` |

## Hosted v2 prerequisite

Desktop v1 relies on its single Electron-main coordinator plus the durable file
lock to serialize driver changes. Before any hosted or multi-writer deployment,
the durable core transition boundary must also enforce monotonic driver
generations against the on-disk record as a second line of defense. That
defense-in-depth invariant is deferred from this Desktop v1 proof; do not infer
that a stale hosted writer is fenced by the current local coordinator alone.

## Deferred adjacent issue

The remote Code connector still resolves its CLI from the monorepo and falls
back to `pnpm`. It is outside Multi-Frontier v1 but needs the same packaged
runtime treatment before the remote connector can be considered installed-app
safe.
