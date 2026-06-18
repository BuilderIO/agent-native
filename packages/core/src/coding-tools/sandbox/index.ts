/**
 * Sandbox-adapter selection seam.
 *
 * `getSandboxAdapter()` resolves which backend the `run-code` tool executes in.
 * By default it returns the local child-process adapter (preserving today's
 * behavior). The active adapter can be overridden in two ways, both designed so
 * a remote/durable backend can be plugged in later WITHOUT touching the agent
 * loop or `run-code.ts`:
 *
 *  1. Programmatically, via `registerSandboxAdapter(adapter)` — e.g. a host
 *     process that wants every `run-code` call to run in a remote container.
 *  2. By env var `AGENT_NATIVE_SANDBOX` for built-in adapters. Currently only
 *     `local` (the default) is wired; unknown values fall back to local.
 *
 * Resolution order: an explicitly registered adapter wins; otherwise the env
 * var selects a built-in; otherwise the local adapter is used.
 *
 * // TODO: remote/durable adapter for long jobs. The local child-process
 * // adapter is bounded by the hosting process — on the hosted platform that
 * // means the agent loop's soft execution ceiling (~40s before timeout/
 * // continuation thrash). A remote or durable adapter (Docker, a
 * // Vercel-Sandbox-style runner, or a queued background worker) is the lever
 * // to exceed that ceiling: it would implement `SandboxAdapter.run` against an
 * // out-of-process runtime, tunnel the loopback bridge (or proxy bridge calls
 * // back to the parent), and let large data jobs run to completion
 * // independently of the request lifecycle. Register it here under a new
 * // `AGENT_NATIVE_SANDBOX` value (e.g. `remote`) and via
 * // `registerSandboxAdapter()`.
 */

import type { SandboxAdapter } from "./adapter.js";
import { LocalChildProcessAdapter } from "./local-child-process-adapter.js";

export type {
  SandboxAdapter,
  SandboxRunRequest,
  SandboxRunResult,
  SandboxEnv,
} from "./adapter.js";
export { LocalChildProcessAdapter } from "./local-child-process-adapter.js";

/** Built-in adapter ids selectable via the `AGENT_NATIVE_SANDBOX` env var. */
const BUILT_IN_ADAPTERS: Record<string, () => SandboxAdapter> = {
  local: () => new LocalChildProcessAdapter(),
};

/** Lazily-constructed default (local) adapter, shared across calls. */
let defaultAdapter: SandboxAdapter | undefined;

/** Explicitly registered adapter, if any. Takes precedence over the env var. */
let registeredAdapter: SandboxAdapter | undefined;

/**
 * Override the sandbox backend for all subsequent `run-code` invocations.
 * Intended for hosts that want to plug in a Docker/remote/durable adapter. Pass
 * `null` to clear the override and fall back to env-var / default resolution.
 */
export function registerSandboxAdapter(adapter: SandboxAdapter | null): void {
  registeredAdapter = adapter ?? undefined;
}

/**
 * Resolve the active sandbox adapter.
 *
 * Order: explicitly registered adapter → built-in selected by
 * `AGENT_NATIVE_SANDBOX` → local child-process default.
 */
export function getSandboxAdapter(): SandboxAdapter {
  if (registeredAdapter) return registeredAdapter;

  const selected = (process.env.AGENT_NATIVE_SANDBOX ?? "")
    .trim()
    .toLowerCase();
  if (selected && selected !== "local") {
    const factory = BUILT_IN_ADAPTERS[selected];
    if (factory) return factory();
    // Unknown value: fall through to the local default rather than failing the
    // run. (A remote adapter is registered programmatically; see the TODO above.)
  }

  if (!defaultAdapter) defaultAdapter = new LocalChildProcessAdapter();
  return defaultAdapter;
}

/**
 * Reset selection state (registered override + cached default). Test-only helper
 * so specs can exercise selection without leaking adapters across cases.
 */
export function resetSandboxAdapterForTests(): void {
  registeredAdapter = undefined;
  defaultAdapter = undefined;
}
