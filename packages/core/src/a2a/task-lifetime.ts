/**
 * One home for the clocks that decide when an `a2a_tasks` row has stopped
 * making progress, and one pure rule that reads them.
 *
 * These thresholds used to live only inside `refireStuckAsyncTaskIfNeeded` in
 * `handlers.ts`, which made recovery reachable from exactly one place: an
 * inbound `tasks/get`. A second, push-based driver (`stale-task-sweep.ts`)
 * needs the identical rule, and a second copy of these numbers is how the two
 * drivers would silently disagree about whether a task is dead.
 */

import { getAppConfig } from "../app-config/store.js";

export const A2A_QUEUED_DISPATCH_STUCK_AFTER_MS = 10_000;
export const A2A_PROCESSING_STUCK_AFTER_MS = 5 * 60 * 1000;
export const A2A_PROCESSING_HEARTBEAT_MS = 30_000;

export const A2A_QUEUED_LIFETIME_FAILURE_REASON =
  "The async A2A task could not be started because dispatch kept failing. Please retry the request.";
export const A2A_PROCESSING_STALE_FAILURE_REASON =
  "The async A2A processor timed out before completing. Please retry the request.";
export const A2A_PROCESSING_LIFETIME_FAILURE_REASON =
  "The async A2A processor exceeded its maximum run time. Please retry the request.";

export function a2aQueuedLifetimeMaxMs(): number {
  return getAppConfig().a2a.queuedLifetimeMaxMs;
}

export function a2aProcessingLifetimeMaxMs(): number {
  return getAppConfig().a2a.processingLifetimeMaxMs;
}

/**
 * Only a task handed to the async processor is recoverable without its caller.
 * A synchronous A2A request runs its handler inline inside the caller's own
 * request (the non-async branch of `handleSend`), stores no processor
 * metadata, and legitimately sits in `working` for as long as that call takes
 * — failing one would terminalize live work and race the handler's own settle.
 * Both recovery drivers gate on this before classifying.
 */
export function isA2ABackgroundRecoverable(
  metadata: Record<string, unknown> | undefined | null,
): boolean {
  return !!metadata?.__a2a_processor;
}

export interface A2ATaskLivenessRow {
  statusState: string;
  createdAt: number;
  updatedAt: number;
}

export type A2AStuckVerdict =
  | { kind: "healthy" }
  | { kind: "refire-queued" }
  | { kind: "fail-queued"; createdAtCutoff: number; reason: string }
  | {
      kind: "fail-processing";
      processingCutoff: number;
      createdAtCutoff: number;
      reason: string;
    };

/**
 * The single rule both recovery drivers read. `refire-queued` is only
 * actionable by a driver that holds an inbound request event (dispatch needs
 * the caller's origin and the app's A2A config); a background sweep treats it
 * as "not yet terminal" and leaves the row alone.
 */
export function classifyStuckA2ATask(
  row: A2ATaskLivenessRow,
  now: number,
): A2AStuckVerdict {
  if (row.statusState === "submitted" || row.statusState === "working") {
    const createdAtCutoff = now - a2aQueuedLifetimeMaxMs();
    if (row.createdAt <= createdAtCutoff) {
      return {
        kind: "fail-queued",
        createdAtCutoff,
        reason: A2A_QUEUED_LIFETIME_FAILURE_REASON,
      };
    }
    if (row.updatedAt <= now - A2A_QUEUED_DISPATCH_STUCK_AFTER_MS) {
      return { kind: "refire-queued" };
    }
    return { kind: "healthy" };
  }

  if (row.statusState === "processing") {
    const processingCutoff = now - A2A_PROCESSING_STUCK_AFTER_MS;
    const createdAtCutoff = now - a2aProcessingLifetimeMaxMs();
    const isStale = row.updatedAt <= processingCutoff;
    const isOverLifetime = row.createdAt <= createdAtCutoff;
    if (isStale || isOverLifetime) {
      return {
        kind: "fail-processing",
        processingCutoff,
        createdAtCutoff,
        reason: isStale
          ? A2A_PROCESSING_STALE_FAILURE_REASON
          : A2A_PROCESSING_LIFETIME_FAILURE_REASON,
      };
    }
  }

  return { kind: "healthy" };
}
