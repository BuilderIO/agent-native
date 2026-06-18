---
title: "Sandbox Adapters"
description: "Swap the backend that runs the agent's run-code tool — local child process by default, a remote/durable runner when you need to exceed the hosted code-exec ceiling."
---

# Sandbox Adapters

The `run-code` tool runs agent-supplied JavaScript in an isolated environment. **Sandbox adapters** factor the _execution_ concern out of that tool so the backend can be swapped — a local child process by default, or a Docker / remote / durable runner — without touching the agent loop, `run-code.ts`, the localhost bridge, the env scrub, or the output formatting.

## Why a seam {#why}

The default backend spawns a locked-down local Node child process. That's bounded by the hosting process: on the hosted platform it shares the agent loop's soft execution ceiling (~40s before timeout/continuation thrash). A remote or durable adapter is the lever to exceed that ceiling — it runs large data jobs to completion independently of the request lifecycle.

Keeping the contract narrow means a remote adapter inherits the same security posture. The parent process keeps ownership of everything secret-bearing: it builds the sandbox module, runs the localhost bridge (which holds the request context and applies host allowlists + SSRF guards), scrubs the env, and formats output. An adapter only receives an already-prepared, **non-secret** module source plus resource limits — it is responsible solely for _running_ it and capturing stdout/stderr/exit status.

## The interface {#interface}

The seam lives in core at `packages/core/src/coding-tools/sandbox/` — `adapter.ts` (the contract), `index.ts` (selection: `getSandboxAdapter()` / `registerSandboxAdapter()`), and `local-child-process-adapter.ts` (the default). It is wired in-package by `run-code.ts`; a host plugs in a different backend through the `index.ts` registration helper (or, for a Docker backend, via the [blueprint](/docs/blueprint-installer) that edits these files directly).

Every backend implements `SandboxAdapter`:

```ts
interface SandboxAdapter {
  /** Stable id, surfaced for diagnostics and adapter selection. */
  readonly id: string;
  /** Execute one prepared sandbox module and capture its output. */
  run(request: SandboxRunRequest): Promise<SandboxRunResult>;
}
```

The request and result are intentionally small and opaque:

```ts
interface SandboxRunRequest {
  /**
   * The complete ESM module source to execute. Already wraps the user's code
   * and embeds the loopback bridge URL/token; the adapter does NOT parse or
   * rewrite it.
   */
  moduleSource: string;
  /**
   * Scrubbed environment — only safe POSIX vars (PATH/HOME/TMPDIR/…), never app
   * secrets. Adapters must not augment this with the parent's own environment.
   */
  env: Record<string, string>;
  /** Hard wall-clock timeout in milliseconds. The adapter must enforce it. */
  timeoutMs: number;
  /**
   * Loopback port of the parent's bridge server (reachable over 127.0.0.1). A
   * remote adapter that can't reach the parent's loopback must tunnel or proxy
   * this to support bridge-backed globals (`appAction`, `providerFetch`, …).
   */
  bridgePort: number;
}

interface SandboxRunResult {
  stdout: string;
  stderr: string;
  /** `0` on clean exit, non-zero on failure, `null` when killed by a signal. */
  exitCode: number | null;
  /** True when the run was killed for exceeding `timeoutMs`. */
  timedOut: boolean;
}
```

## The default: `LocalChildProcessAdapter` {#default}

Out of the box, `getSandboxAdapter()` returns `LocalChildProcessAdapter` (`id: "local-child-process"`). It preserves the historical `run-code` behavior byte-for-byte:

- The prepared module source is written to a fresh temp dir.
- The child runs with the scrubbed env (no secrets), with `TMPDIR`/`TEMP`/`TMP` pointed inside the sandbox dir.
- When the Node permission model is available (`--permission`, or `--experimental-permission` on Node 20), the child is denied filesystem access outside its temp dir, plus child processes, workers, and native addons. Outbound network is _not_ blocked by the permission model — but the env scrub means such requests carry no credentials, and all authenticated calls go through the parent's loopback bridge.
- A timeout sends `SIGTERM`, then `SIGKILL` after a 2s grace period.
- Temp files are cleaned up best-effort after the run.

> [!WARNING]
> The default adapter uses `node:child_process`, which does not exist on edge/worker runtimes (Cloudflare Workers, Netlify Edge Functions). Run `run-code` in a standard Node.js environment, or register a remote adapter.

## Selecting an adapter {#selection}

Resolution order — an explicitly registered adapter wins; otherwise the env var selects a built-in; otherwise the local default is used:

```txt
registerSandboxAdapter(adapter)  →  AGENT_NATIVE_SANDBOX  →  local default
```

### `AGENT_NATIVE_SANDBOX` env var {#env}

Selects a built-in adapter by id. Currently only `local` (the default) is wired; unknown values fall back to local rather than failing the run.

```bash
AGENT_NATIVE_SANDBOX=local   # the default — explicit
```

### `registerSandboxAdapter()` {#register}

A host process overrides the backend for all subsequent `run-code` invocations through the seam's `index.ts` — for example, to run every call in a remote container:

```ts
import {
  registerSandboxAdapter,
  type SandboxAdapter,
} from "./coding-tools/sandbox/index.js";

class RemoteSandboxAdapter implements SandboxAdapter {
  readonly id = "remote";
  async run(request) {
    // Ship request.moduleSource to the durable runner, enforce request.timeoutMs,
    // proxy bridge calls back to request.bridgePort, and return stdout/stderr/exitCode.
  }
}

registerSandboxAdapter(new RemoteSandboxAdapter());
// Pass `null` to clear the override and fall back to env-var / default resolution.
```

## The seam for a durable runner {#durable}

This interface is deliberately the seam for a future remote/durable sandbox. A remote or durable adapter (Docker, a Vercel-Sandbox-style runner, or a queued background worker) would:

1. Implement `SandboxAdapter.run` against an out-of-process runtime.
2. Tunnel the loopback bridge (or proxy bridge calls back to the parent).
3. Let large data jobs run to completion independently of the request lifecycle — exceeding the hosted ~40s code-exec ceiling that bounds the local child-process adapter.

Register it under a new `AGENT_NATIVE_SANDBOX` value (e.g. `remote`) and/or via `registerSandboxAdapter()`. The agent loop and `run-code.ts` never change.

> [!TIP]
> The `agent-native add sandbox docker` blueprint emits a full, self-contained recipe for implementing a Docker adapter against this seam. See [Blueprint Installer](/docs/blueprint-installer).

## What's next

- [**Blueprint Installer**](/docs/blueprint-installer) — `agent-native add sandbox docker` prints a Docker-adapter recipe
- [**Agent Teams**](/docs/agent-teams) — delegating heavy work to sub-agents
- [**Security**](/docs/security) — the env scrub and bridge allowlist posture
