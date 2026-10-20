// The bundler and the vitest base config import this, not bounded-tasks.ts:
// packages that typecheck @agent-native/core/vitest-config from source load
// several @types/node versions, and node:worker_threads does not type there.

/**
 * Identifier the bundled task module is assigned to. `bundleBoundedTaskSource`
 * emits an IIFE with this global name; the worker host reads it back.
 */
export const BOUNDED_TASK_GLOBAL = "__agentNativeBoundedTasks";

/**
 * A self-contained task module, bundled to one script. Produce it with
 * `bundleBoundedTaskSource` (Node, esbuild); never hand-write `code`.
 */
export interface BoundedTaskSource {
  readonly kind: "bounded-task-source";
  readonly name: string;
  readonly code: string;
}
