import type { ScheduledTriggerStatus } from "../../jobs/actions/get-scheduled-trigger-status.js";

// Re-exported from the action rather than restated here so the two cannot
// drift; `import type` is erased, so no server code reaches the client bundle.
export type { ScheduledTriggerStatus };

/**
 * Three-state view of the scheduler status query.
 *
 * `unknown` exists so a FAILED check cannot pass for a healthy one. The status
 * action can 404 on an older deploy, 403 behind an auth boundary, or fail
 * discovery — none of which say anything about whether schedules fire, and all
 * of which read as "fine" under a plain `data?.available !== false`. `loading`
 * stays separate because it resolves on its own in milliseconds; an error does
 * not.
 *
 * Deliberately kept in its own module, free of the query hook: the pure
 * state→consequence mapping below is what the UI branches on, and it stays real
 * in tests that mock the data layer.
 */
export type ScheduledTriggerState =
  | { kind: "loading" }
  | { kind: "unknown"; error: Error | null }
  | { kind: "resolved"; status: ScheduledTriggerStatus };

/** Whether a schedule-triggered automation will fire, as far as the UI knows. */
export type ScheduleFiring = "fires" | "never" | "unknown";

export function scheduleFiringFor(
  state: ScheduledTriggerState,
): ScheduleFiring {
  if (state.kind === "resolved") {
    return state.status.available ? "fires" : "never";
  }
  // Loading leans optimistic on purpose: accusing a working deploy of being
  // broken mid-flight is worse than showing the warning a beat late. An errored
  // check gets no such benefit — it never resolves, so the optimism would be
  // permanent and would license a confident "Next run" forever.
  return state.kind === "unknown" ? "unknown" : "fires";
}
