# Blueprint: implement a Docker sandbox adapter

You are a coding agent working inside an **agent-native** app (a repo built on
`@agent-native/core`). Apply this blueprint as real source changes on the
current branch. Do not just describe the work — do it, then verify.

## Goal

Run the `run-code` tool's agent-supplied JavaScript inside a **Docker
container** instead of a local child process, without touching the agent loop,
`run-code.ts`, the localhost bridge, the env scrub, or the output formatting.
You implement the `SandboxAdapter` seam and select it via
`AGENT_NATIVE_SANDBOX` / `registerSandboxAdapter()`.

## Read first

Read these three files — they ARE the contract:

- `packages/core/src/coding-tools/sandbox/adapter.ts` — the `SandboxAdapter`
  interface plus `SandboxRunRequest` / `SandboxRunResult` / `SandboxEnv`.
- `packages/core/src/coding-tools/sandbox/index.ts` — `getSandboxAdapter()`
  resolution order (registered → `AGENT_NATIVE_SANDBOX` built-in → local
  default) and `registerSandboxAdapter()`. Note the `// TODO: remote/durable
adapter` block — that is exactly this work.
- `packages/core/src/coding-tools/sandbox/local-child-process-adapter.ts` — the
  reference implementation to mirror for timeout enforcement and stdout/stderr
  capture.

Key invariant: the adapter receives an **already-prepared, non-secret**
`moduleSource` (it already embeds the loopback bridge URL/token and wraps the
user's code) plus a scrubbed `env`. The adapter only **runs** it. It must never
augment `env` with the parent's environment and never see app secrets.

## Files to touch

1. **`packages/core/src/coding-tools/sandbox/docker-adapter.ts`** — implement
   `class DockerSandboxAdapter implements SandboxAdapter`:
   - `readonly id = "docker"`.
   - `run(request)`:
     - Write `request.moduleSource` to a temp ESM file (or pass via stdin).
     - Spawn `docker run --rm` with a minimal Node image, the file mounted
       read-only, `--network` configured so the sandbox can still reach the
       parent's loopback bridge on `request.bridgePort` (use
       `--add-host=host.docker.internal:host-gateway` and rewrite/allow the
       bridge host, or `--network=host` where acceptable — document the
       trade-off in a comment). Pass `request.env` explicitly; do NOT inherit
       the host env. Apply CPU/memory limits.
     - Enforce `request.timeoutMs` as a hard wall-clock kill (`docker kill`),
       and set `timedOut: true` when you kill for timeout.
     - Capture stdout/stderr and the container exit code into
       `SandboxRunResult` (`exitCode: null` when terminated by signal).
2. **Wire selection** in
   `packages/core/src/coding-tools/sandbox/index.ts` by adding `docker` to the
   `BUILT_IN_ADAPTERS` map (`docker: () => new DockerSandboxAdapter()`), so
   `AGENT_NATIVE_SANDBOX=docker` selects it. A host process can also call
   `registerSandboxAdapter(new DockerSandboxAdapter())` to force it everywhere.
3. **Add `docker-adapter.spec.ts`** mirroring the existing sandbox
   `index.spec.ts`: assert `getSandboxAdapter()` returns the Docker adapter when
   `AGENT_NATIVE_SANDBOX=docker`, that a registered adapter wins over the env
   var, and that timeout produces `timedOut: true`. Skip the real-`docker`
   integration path when the Docker daemon is unavailable (guard on a probe).

## Framework rules to honor

- Do not change `run-code.ts`, the agent loop, the bridge, the env scrub, or the
  output formatting — the whole point of the seam is that they stay untouched.
- Preserve the security posture: the adapter sees only scrubbed env + prepared
  module source. Never re-inject the parent env or app secrets.
- This is a publishable `packages/core` source change → add a `.changeset/*.md`.

## Verify

1. `tsgo --noEmit` for `@agent-native/core` passes.
2. `docker-adapter.spec.ts` passes.
3. With Docker available, set `AGENT_NATIVE_SANDBOX=docker` and run a `run-code`
   task that uses `appAction`/`providerFetch` through the loopback bridge;
   confirm it executes in a container and the bridge round-trips. Confirm a
   long-running task is killed at `timeoutMs` with `timedOut: true`.
