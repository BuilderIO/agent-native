export type CanvasAgentState =
  | "ready"
  | "working"
  | "needs-answer"
  | "warning"
  | "applying"
  | "done"
  | "failed";

export interface CanvasAgentStateInputs {
  generating: boolean;
  generationIssue: boolean;
  pendingQuestionCount: number;
  resolveNodeRewritePending: boolean;
  offline: boolean;
  lastRunCompletedAt: number | null;
}

const DEFAULT_DONE_WINDOW_MS = 4000;

/**
 * Pure reducer for the canvas agent-state badge. Priority (highest wins):
 * failed > needs-answer > applying > working > warning > done > ready.
 * "done" auto-decays: reported only while now - lastRunCompletedAt <
 * doneWindowMs, else "ready". The consumer owns the decay tick; no timers here.
 */
export function deriveCanvasAgentState(
  inputs: CanvasAgentStateInputs,
  now: number,
  doneWindowMs: number = DEFAULT_DONE_WINDOW_MS,
): CanvasAgentState {
  if (inputs.generationIssue) return "failed";
  if (inputs.pendingQuestionCount > 0) return "needs-answer";
  if (inputs.resolveNodeRewritePending) return "applying";
  if (inputs.generating) return "working";
  if (inputs.offline) return "warning";
  if (
    inputs.lastRunCompletedAt != null &&
    now - inputs.lastRunCompletedAt < doneWindowMs
  ) {
    return "done";
  }
  return "ready";
}
