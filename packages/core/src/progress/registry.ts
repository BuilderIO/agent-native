import { emit as emitBusEvent } from "../event-bus/bus.js";
import { insertRun, updateRun, getRun, listRuns, deleteRun } from "./store.js";
import type { AgentRun, StartRunInput, UpdateProgressInput } from "./types.js";

/**
 * Start a new run. Emits `run.progress.started` on the event bus so
 * automations can react (e.g. pinning the row in a UI tray).
 */
export async function startRun(input: StartRunInput): Promise<AgentRun> {
  const run = await insertRun(input);
  try {
    emitBusEvent(
      "run.progress.started",
      {
        runId: run.id,
        title: run.title,
        step: run.step,
      },
      { owner: run.owner },
    );
  } catch {
    // best-effort
  }
  return run;
}

/**
 * Update a run in-flight. Emits `run.progress.updated`. Caller supplies
 * partial fields — any omitted field stays unchanged.
 */
export async function updateRunProgress(
  id: string,
  owner: string,
  input: UpdateProgressInput,
): Promise<AgentRun | null> {
  const run = await updateRun(id, owner, input);
  if (!run) return null;
  try {
    emitBusEvent(
      "run.progress.updated",
      {
        runId: run.id,
        percent: run.percent,
        step: run.step,
        status: run.status,
      },
      { owner: run.owner },
    );
  } catch {
    // best-effort
  }
  return run;
}

/**
 * Finalize a run with a terminal status. Convenience wrapper around
 * `updateRunProgress` that ensures `completed_at` is set.
 */
export async function completeRun(
  id: string,
  owner: string,
  status: "succeeded" | "failed" | "cancelled",
  extras?: { step?: string; metadata?: Record<string, unknown> },
): Promise<AgentRun | null> {
  return updateRunProgress(id, owner, {
    status,
    percent: status === "succeeded" ? 100 : undefined,
    step: extras?.step,
    metadata: extras?.metadata,
  });
}

export { getRun, listRuns, deleteRun };
