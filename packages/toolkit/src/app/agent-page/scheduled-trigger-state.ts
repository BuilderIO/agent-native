import type { ScheduledTriggerStatus } from "@agent-native/core/jobs/actions/get-scheduled-trigger-status";

export type { ScheduledTriggerStatus };

export type ScheduledTriggerState =
  | { kind: "loading" }
  | { kind: "unknown"; error: Error | null }
  | { kind: "resolved"; status: ScheduledTriggerStatus };

export type ScheduleFiring = "fires" | "never" | "unknown";

export function scheduleFiringFor(
  state: ScheduledTriggerState,
): ScheduleFiring {
  if (state.kind === "resolved") {
    return state.status.available ? "fires" : "never";
  }
  return state.kind === "unknown" ? "unknown" : "fires";
}
