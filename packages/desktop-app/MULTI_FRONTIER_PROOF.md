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

## Deferred adjacent issue

The remote Code connector still resolves its CLI from the monorepo and falls
back to `pnpm`. It is outside Multi-Frontier v1 but needs the same packaged
runtime treatment before the remote connector can be considered installed-app
safe.
