import {
  BoundedTaskError,
  type BoundedTaskErrorCode,
} from "@agent-native/core/collab";

import { contentLiveCopy } from "./binding.js";
import { CONTENT_HOLDS_BODY_TASK } from "./task-names.js";

// Limits a body can hit. Anything else the worker reports is a bug here.
const UNCHECKED: ReadonlySet<BoundedTaskErrorCode> = new Set([
  "unavailable",
  "queue_full",
  "queue_timeout",
  "input_too_large",
  "deadline_exceeded",
  "memory_exceeded",
  "output_too_large",
  "worker_crashed",
]);

/**
 * Whether a switched page's stored body holds every change a browser save
 * made to the body it was authored on, with any other changes clear of them
 * (`bodyHoldsChanges`). The save's text then reached the live copy over
 * collab, and only a peer's commits differ. `unchecked` when the comparison
 * hit the worker's limits.
 */
export async function liveCopyHoldsSave(args: {
  base: string;
  stored: string;
  candidate: string;
}): Promise<"held" | "unheld" | "unchecked"> {
  try {
    const held = await contentLiveCopy.runner.run<boolean>(
      CONTENT_HOLDS_BODY_TASK,
      args,
    );
    return held ? "held" : "unheld";
  } catch (error) {
    if (error instanceof BoundedTaskError && UNCHECKED.has(error.code)) {
      return "unchecked";
    }
    throw error;
  }
}
