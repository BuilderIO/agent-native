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
| Sole-writer ownership | Not proven; contradicted for legacy Code files | Electron main and the runner child can both mutate the same legacy run record and transcript. The chosen resolution is cross-process arbitration for those compatibility files and Electron-only writes for new Multi-Frontier parent state. This remains a Phase 2 blocker until an OS-process test proves no field loss. |
| Idempotent event append | Partial | Stores can reject a reused id with a conflicting payload in one process, but scan-then-append is not yet atomic between processes. Legacy production callers also do not yet supply stable ids. Cross-process exclusion is required; stable ids at retrying legacy call sites remain follow-up work unless wired before Phase 2. |
| Bounded renderer IPC | Proven for event count only | Transcript snapshots are limited to the newest 200 events and offset tails are de-duplicated. Serialized byte size and individual oversized events are not yet bounded. |
| Additive schema | Proven at library level | The Multi-Frontier record and event schema is additive and isolated from legacy run records. |
| Persisted payload allowlist and retention | Not addressed | Legacy run/transcript and new Multi-Frontier stores do not yet enforce secret stripping, payload allowlists, or disk retention. Provider usage persistence must not begin until its normalized allowlist and eviction policy are implemented. |

This ledger intentionally distinguishes a library proof from an installed-app or
multi-process proof. A property does not advance to proven merely because the
supporting API exists.

## Deferred adjacent issue

The remote Code connector still resolves its CLI from the monorepo and falls
back to `pnpm`. It is outside Multi-Frontier v1 but needs the same packaged
runtime treatment before the remote connector can be considered installed-app
safe.
