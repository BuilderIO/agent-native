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

const BUILT_IN_ADAPTERS: Record<string, () => SandboxAdapter> = {
  local: () => new LocalChildProcessAdapter(),
  background: () => new BackgroundQueueAdapter(),
};

let defaultAdapter: SandboxAdapter | undefined;

let registeredAdapter: SandboxAdapter | undefined;

export function registerSandboxAdapter(adapter: SandboxAdapter | null): void {
  registeredAdapter = adapter ?? undefined;
}

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

export function resolveExecutionSandboxAdapter(): SandboxAdapter {
  const adapter = getSandboxAdapter();
  if (!isQueuedSandboxAdapter(adapter)) return adapter;
  if (!defaultAdapter) defaultAdapter = new LocalChildProcessAdapter();
  return defaultAdapter;
}

export function resetSandboxAdapterForTests(): void {
  registeredAdapter = undefined;
  defaultAdapter = undefined;
}
