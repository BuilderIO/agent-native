import { defineMachine } from "@agent-native/core/state-machine";

import type { RunStatus } from "../../app/lib/model/contracts.js";
import { runStatusSchema } from "../../app/lib/model/contracts.js";

/** Live execution state and immutable terminal history share one lifecycle. */
export const cellRunMachine = defineMachine({
  id: "analytics2.cell-run",
  states: ["queued", "running", "complete", "error", "cancelled"],
  initial: "queued",
  terminal: ["complete", "error", "cancelled"],
  transitions: {
    start: { from: ["queued"], to: "running" },
    succeed: { from: ["running"], to: "complete" },
    fail: { from: ["running"], to: "error" },
    cancel: { from: ["queued", "running"], to: "cancelled" },
  },
});

export class RunTransitionError extends Error {
  readonly code = "analytics_invalid_run_transition";
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "RunTransitionError";
  }
}

/**
 * A recorded history row is the outcome of a run, so only a terminal state is
 * accepted. Passing a live state here would create history that can never be
 * updated; callers that need live state write a cell output instead.
 */
export function requireTerminalRunStatus(value: unknown): RunStatus {
  const status = runStatusSchema.parse(value);
  if (!cellRunMachine.isTerminal(status)) {
    throw new RunTransitionError(
      `Only a finished run can be recorded; "${status}" is a live state.`,
    );
  }
  return status;
}

/** Validates a persisted state before it reaches a DTO. */
export function requireStoredRunStatus(value: unknown): RunStatus {
  return runStatusSchema.parse(value);
}
