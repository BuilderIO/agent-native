import type { WorkflowWake } from "./types.js";

const WAKE_KEY = Symbol.for("@agent-native/core/workflow.wake-bus");
type WakeHandler = (wake: WorkflowWake) => void | Promise<void>;

interface WakeState {
  handlers: Set<WakeHandler>;
}

function state(): WakeState {
  const global = globalThis as typeof globalThis & { [WAKE_KEY]?: WakeState };
  if (!(global[WAKE_KEY]?.handlers instanceof Set)) {
    global[WAKE_KEY] = { handlers: new Set() };
  }
  return global[WAKE_KEY];
}

/**
 * Emits only an ephemeral hint. Consumers must claim the durable row by id;
 * this payload is never an authority for dispatch or execution.
 */
export function emitWorkflowWake(wake: WorkflowWake): void {
  if (!wake.rowId.trim()) throw new Error("Workflow wake rowId is required");
  const frozenWake = Object.freeze({ ...wake });
  for (const handler of state().handlers) void handler(frozenWake);
}

export function subscribeWorkflowWake(handler: WakeHandler): () => void {
  const handlers = state().handlers;
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function __resetWorkflowWakeBus(): void {
  state().handlers.clear();
}
