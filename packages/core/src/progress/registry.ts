import { z } from "zod";
import { emit as emitBusEvent } from "../event-bus/bus.js";
import { registerEvent } from "../event-bus/registry.js";
import type { EventDefinition } from "../event-bus/types.js";
import { insertRun, updateRun, getRun, listRuns, deleteRun } from "./store.js";
import {
  PROGRESS_STATUSES,
  type AgentRun,
  type StartRunInput,
  type UpdateProgressInput,
} from "./types.js";
import { truncate } from "../shared/truncate.js";

registerEvent({
  name: "run.progress.started",
  description:
    "Fires when a long-running agent task begins. Pair with run.progress.updated to build watchdogs for stuck work.",
  payloadSchema: z.object({
    runId: z.string(),
    title: z.string(),
    step: z.string().optional(),
  }) as unknown as EventDefinition["payloadSchema"],
  example: {
    runId: "run_abc",
    title: "Triage 128 unread emails",
    step: "Fetching inbox",
  },
});

registerEvent({
  name: "run.progress.updated",
  description:
    "Fires on every progress update or terminal transition. Subscribe to watch for slow runs (status=running and elapsed > N) or fan terminal status to a notification.",
  payloadSchema: z.object({
    runId: z.string(),
    percent: z.number().nullable(),
    step: z.string().optional(),
    status: z.enum(PROGRESS_STATUSES),
  }) as unknown as EventDefinition["payloadSchema"],
  example: {
    runId: "run_abc",
    percent: 45,
    step: "Classifying 56/128",
    status: "running",
  },
});

const MAX_TITLE_LEN = 100;
const MAX_STEP_LEN = 200;

/**
 * Start a new run. Emits `run.progress.started` on the event bus so
 * automations can react (e.g. pinning the row in a UI tray).
 */
export async function startRun(input: StartRunInput): Promise<AgentRun> {
  const run = await insertRun({
    ...input,
    title: truncate(input.title, MAX_TITLE_LEN),
    step: truncate(input.step, MAX_STEP_LEN),
  });
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
  const run = await updateRun(id, owner, {
    ...input,
    step: truncate(input.step, MAX_STEP_LEN),
  });
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
