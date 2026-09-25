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
 *  2. By env var `AGENT_NATIVE_SANDBOX` for built-in adapters: `local` (the
 *     default) and `background` (the durable queued backend — every `run-code`
 *     call is enqueued to `sandbox_executions` and executed out-of-request;
 *     see `./background.ts`). Unknown values fall back to local.
 *
 * Resolution order: an explicitly registered adapter wins; otherwise the env
 * var selects a built-in; otherwise the local adapter is used.
 *
 * The `background` adapter is a QUEUE MARKER, not an executor: `run-code`
 * detects it via `isQueuedSandboxAdapter()` and enqueues the raw code instead
 * of preparing a module (a prepared module embeds the enqueueing request's
 * loopback bridge, which dies with that request). The queued work is later
 * executed through `resolveExecutionSandboxAdapter()` — the active adapter
 * unless that adapter is itself queued, in which case the local child process
 * — so a host-registered Docker/remote adapter is still honored for the
 * actual execution.
 */

import type { SandboxAdapter } from "./adapter.js";
import {
  BackgroundQueueAdapter,
  isQueuedSandboxAdapter,
} from "./background.js";
import { LocalChildProcessAdapter } from "./local-child-process-adapter.js";

export type {
  SandboxAdapter,
  SandboxRunRequest,
  SandboxRunResult,
  SandboxEnv,
} from "./adapter.js";
export { LocalChildProcessAdapter } from "./local-child-process-adapter.js";
export {
  BackgroundQueueAdapter,
  isQueuedSandboxAdapter,
  registerSandboxExecutionRunner,
  resetSandboxBackgroundForTests,
  enqueueSandboxExecution,
  driveSandboxExecution,
  processQueuedSandboxExecution,
  drainDueSandboxExecutions,
  SANDBOX_PROCESS_EXECUTION_PATH,
  SANDBOX_EXECUTION_REDRIVE_AFTER_MS,
  BACKGROUND_DEFAULT_TIMEOUT_MS,
  BACKGROUND_MAX_TIMEOUT_MS,
  type SandboxExecutionRunner,
  type SandboxExecutionRunInput,
  type SandboxExecutionRunOutput,
} from "./background.js";
export {
  getSandboxExecutionForOwner,
  type SandboxExecutionRow,
  type SandboxExecutionStatus,
} from "./executions-store.js";

/** Built-in adapter ids selectable via the `AGENT_NATIVE_SANDBOX` env var. */
const BUILT_IN_ADAPTERS: Record<string, () => SandboxAdapter> = {
  local: () => new LocalChildProcessAdapter(),
  background: () => new BackgroundQueueAdapter(),
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
 * Resolve the adapter to use for ACTUALLY EXECUTING a prepared sandbox module.
 * Identical to `getSandboxAdapter()` except a queued (background) adapter is
 * replaced by the local child-process default — the background executor and
 * the foreground fallback both call this so they can never recurse back into
 * the queue.
 */
export function resolveExecutionSandboxAdapter(): SandboxAdapter {
  const adapter = getSandboxAdapter();
  if (!isQueuedSandboxAdapter(adapter)) return adapter;
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
