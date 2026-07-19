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

## Phase 0 persistence property ledger

Status as of 2026-07-19, before Phase 2 coordinator wiring:

| Property | Status | Evidence and boundary |
| --- | --- | --- |
| Generation fencing and recovery | Proven at library level | Multi-Frontier store specs reject stale generations and event conflicts, prevent terminal-state regression and failed-driver promotion, and recover interrupted participants as paused, read-only, and lease-revoked. No system coordinator consumes this store yet. |
| Atomic replacement | Proven for single-writer corruption resistance | Same-directory temporary files are renamed over JSON records and cleanup is tested. The helpers do not call `fsync`; durability through a sudden power loss is explicitly deferred for local desktop v1. |
| Sole-writer ownership | Proven for legacy compatibility files; Phase 2 parent writer not yet wired | Shared `O_EXCL` arbitration now covers Electron and runner-child updates to legacy run records and transcripts. An OS-process test applies eight concurrent record patches without field loss. New Multi-Frontier parent state remains Electron-only by design when its coordinator is wired. |
| Idempotent event append | Proven across processes for stable ids; legacy caller adoption partial | Concurrent OS processes appending the same stable id produce exactly one Code transcript line and one Multi-Frontier event line. Reused Multi-Frontier ids with different payloads remain conflicts. Most legacy single-agent production callers still generate fresh ids, so retry-level deduplication there remains follow-up work. |
| Bounded renderer IPC | Proven for count and serialized bytes | Initial snapshots and live tail batches retain at most 200 events and 512 KiB of UTF-8 JSON. Oversized tails become one readable truncation event with structured omission metadata. Offset tails remain de-duplicated upstream. |
| Additive schema | Proven at library level | The Multi-Frontier record and event schema is additive and isolated from legacy run records. |
| Persisted payload allowlist and retention | Not addressed | Legacy run/transcript and new Multi-Frontier stores do not yet enforce secret stripping, payload allowlists, or disk retention. Provider usage persistence must not begin until its normalized allowlist and eviction policy are implemented. |

This ledger intentionally distinguishes a library proof from an installed-app or
multi-process proof. A property does not advance to proven merely because the
supporting API exists.

Cross-process verification command:

```sh
corepack pnpm --dir packages/core exec vitest run \
  src/cli/atomic-json-file.spec.ts \
  src/cli/code-agent-runs.spec.ts \
  src/cli/multi-frontier-runs.spec.ts
```

The lock has a bounded wait, owner-token-checked release, serialized stale-lock
reaping, and dead-PID recovery. The helper still intentionally omits `fsync`;
the local-v1 power-loss durability deferral above is unchanged.

## Phase 1 provider spike record

Verified on 2026-07-19 against Codex CLI 0.144.3 and Claude Code 2.1.208.

Codex app-server was initialized using its experimental JSON-RPC capability.
A real redacted `account/read` plus `account/rateLimits/read` observation
normalized a ChatGPT Pro account, a reported 10,080-minute weekly window at
34%, a model-tier weekly window at 0%, and provider credits. The adapter also
handles the `account/rateLimits/updated` notification, process exit, bounded
backoff, signed-out state, and connection-only fallback. It does not read
`~/.codex/auth.json` or rollout files.

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

## Deferred adjacent issue

The remote Code connector still resolves its CLI from the monorepo and falls
back to `pnpm`. It is outside Multi-Frontier v1 but needs the same packaged
runtime treatment before the remote connector can be considered installed-app
safe.
