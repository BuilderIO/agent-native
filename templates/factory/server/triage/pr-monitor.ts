import type { ExecutorState, TriageItemStatus } from "./contracts.js";

export type PullRequestReviewState =
  | "approved"
  | "changes_requested"
  | "commented"
  | "pending";

export interface PullRequestReviewObservation {
  author: string;
  state: PullRequestReviewState;
  observedAt: string;
}

export type PullRequestCheckState =
  | "queued"
  | "in_progress"
  | "passed"
  | "failed"
  | "cancelled";

export interface PullRequestCheckObservation {
  name: string;
  state: PullRequestCheckState;
  observedAt: string;
}

export interface PullRequestObservation {
  readonly repo: string;
  readonly pullRequestNumber: number;
  readonly headSha: string;
  readonly reviews: readonly PullRequestReviewObservation[];
  readonly checks: readonly PullRequestCheckObservation[];
  readonly observedAt: string;
}

export interface PullRequestMonitorCallback {
  state: ExecutorState;
  observedAt: string;
  terminalReason?: string;
}

export interface PullRequestMonitorInput {
  triageItemId: string;
  runId: string;
  callback?: PullRequestMonitorCallback;
  providerObservation?: PullRequestObservation;
  heartbeatAt?: string;
  now: string;
  timeoutMs: number;
}

export type PullRequestMonitorTerminalState = Extract<
  ExecutorState,
  "completed" | "failed" | "cancelled" | "timed_out" | "reconciliation_required"
>;

export interface TriageItemPatch {
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  coverage: "complete" | "partial" | "unknown" | "unavailable";
  status: TriageItemStatus;
  metadataJson: string;
  lastSeenAt: string;
  updatedAt: string;
}

export interface PullRequestMonitorResult {
  triageItemId: string;
  runId: string;
  state: ExecutorState;
  terminalState: PullRequestMonitorTerminalState | null;
  triageItemPatch: TriageItemPatch | null;
  reason: string;
}

function isTerminalCheck(
  check: PullRequestCheckObservation,
): check is PullRequestCheckObservation & {
  state: "passed" | "failed" | "cancelled";
} {
  return (
    check.state === "passed" ||
    check.state === "failed" ||
    check.state === "cancelled"
  );
}

function getProviderTerminalState(
  observation: PullRequestObservation,
): Exclude<
  PullRequestMonitorTerminalState,
  "timed_out" | "reconciliation_required"
> | null {
  if (
    observation.checks.length === 0 ||
    !observation.checks.every(isTerminalCheck)
  ) {
    return null;
  }
  if (observation.checks.some((check) => check.state === "failed")) {
    return "failed";
  }
  if (observation.checks.some((check) => check.state === "cancelled")) {
    return "cancelled";
  }
  return "completed";
}

function isTimedOut(input: PullRequestMonitorInput): boolean {
  if (input.timeoutMs < 0 || !input.heartbeatAt) {
    return false;
  }
  const heartbeatAge = Date.parse(input.now) - Date.parse(input.heartbeatAt);
  return Number.isFinite(heartbeatAge) && heartbeatAge >= input.timeoutMs;
}

function buildPatch(
  observation: PullRequestObservation,
  state: ExecutorState,
  now: string,
): TriageItemPatch {
  return {
    repository: observation.repo,
    pullRequestNumber: observation.pullRequestNumber,
    headSha: observation.headSha,
    coverage: "complete",
    status:
      state === "reconciliation_required"
        ? "reconciliation_required"
        : state === "failed" || state === "cancelled" || state === "timed_out"
          ? "failed"
          : "evidence_ready",
    metadataJson: JSON.stringify({
      checks: observation.checks,
      reviews: observation.reviews,
      monitorState: state,
    }),
    lastSeenAt: observation.observedAt,
    updatedAt: now,
  };
}

export function reconcilePullRequestRun(
  input: PullRequestMonitorInput,
): PullRequestMonitorResult {
  const providerState = input.providerObservation
    ? getProviderTerminalState(input.providerObservation)
    : null;
  const callback = input.callback;
  const timedOut = isTimedOut(input);
  let state: ExecutorState;
  let reason: string;

  if (timedOut && !providerState) {
    state = "timed_out";
    reason =
      "The run heartbeat exceeded its timeout without a terminal provider observation.";
  } else if (providerState) {
    state = providerState;
    reason = "The provider observation supplies a terminal result for the run.";
  } else if (callback?.state === "completed") {
    state = "reconciliation_required";
    reason =
      "The callback claims completion, but no terminal provider observation was observed.";
  } else if (
    callback?.state === "failed" ||
    callback?.state === "cancelled" ||
    callback?.state === "timed_out" ||
    callback?.state === "reconciliation_required"
  ) {
    state = callback.state;
    reason =
      callback.terminalReason ?? "The callback supplied a terminal run state.";
  } else if (callback) {
    state = callback.state;
    reason =
      input.providerObservation && !providerState
        ? "The provider observation is not terminal; continue monitoring the run."
        : "The run has a non-terminal callback and remains in progress.";
  } else if (!input.providerObservation) {
    state = "reconciliation_required";
    reason =
      "No callback or provider observation was available to reconcile the run.";
  } else {
    state = "reconciliation_required";
    reason =
      "The callback was missed and the provider observation is not terminal.";
  }

  return {
    triageItemId: input.triageItemId,
    runId: input.runId,
    state,
    terminalState:
      state === "submitted" || state === "acknowledged" || state === "running"
        ? null
        : state,
    triageItemPatch: input.providerObservation
      ? buildPatch(input.providerObservation, state, input.now)
      : null,
    reason,
  };
}

export function dedupePullRequestMonitorResults(
  results: readonly PullRequestMonitorResult[],
): PullRequestMonitorResult[] {
  const seen = new Set<string>();
  const deduped: PullRequestMonitorResult[] = [];
  for (const result of results) {
    const key = result.triageItemId;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(result);
    }
  }
  return deduped;
}
