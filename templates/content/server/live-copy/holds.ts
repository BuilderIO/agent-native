import {
  BoundedTaskError,
  createBoundedTaskRunner,
  type BoundedTaskErrorCode,
} from "@agent-native/core/collab";

import { CONTENT_HOLDS_BODY_TASK, type HoldsBodyResult } from "./task-names.js";
import source from "./tasks.ts?bounded-task";

// Its own worker: a save's comparison runs under the page lock, and on the
// live copy's worker a slow one would hold up every page's collab updates.
const runner = createBoundedTaskRunner({ source });

// Limits a body can hit. Anything else the worker reports is a bug here.
const UNCHECKED: ReadonlySet<BoundedTaskErrorCode> = new Set([
  "unavailable",
  "queue_full",
  "queue_timeout",
  "input_too_large",
  "deadline_exceeded",
  "memory_exceeded",
  "worker_crashed",
]);

const RESULTS: ReadonlySet<unknown> = new Set<HoldsBodyResult>([
  "held",
  "unheld",
  "noncanonical",
]);

/**
 * Whether a switched page's stored body holds every change a browser save
 * made to the body it was authored on, with any other changes clear of them
 * (`bodyHoldsChanges`). The save's text then reached the live copy over
 * collab, and only a peer's commits differ. `noncanonical` when the save's
 * body is not its own serialization, and `unchecked` when the comparison hit
 * the worker's limits.
 */
export async function liveCopyHoldsSave(args: {
  base: string;
  stored: string;
  candidate: string;
}): Promise<HoldsBodyResult | "unchecked"> {
  let result: unknown;
  try {
    result = await runner.run<unknown>(CONTENT_HOLDS_BODY_TASK, args);
  } catch (error) {
    if (error instanceof BoundedTaskError && UNCHECKED.has(error.code)) {
      return "unchecked";
    }
    throw error;
  }
  if (!RESULTS.has(result)) {
    throw new TypeError(
      `${CONTENT_HOLDS_BODY_TASK} answered ${JSON.stringify(result)}`,
    );
  }
  return result as HoldsBodyResult;
}
