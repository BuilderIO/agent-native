import type {
  ZoomFailureCause,
  ZoomSnapshotRead,
} from "./_runtime-budget-zoom-snapshot";
import {
  measureRuntimeZoom,
  readZoomUntilAvailable,
} from "./runtime-budget-zoom";

type Phase = "baseline" | "apply" | "settle";
type SnapshotError = Extract<ZoomSnapshotRead, { status: "error" }>;
type CleanupOutcome =
  | { status: "not-requested" | "pending" | "completed" }
  | { status: "failed"; cause: ZoomFailureCause };

type AttemptError =
  | { phase: Phase; reason: "snapshot-error"; snapshotError: SnapshotError }
  | {
      phase: Phase;
      reason: "deadline-exceeded" | "operation-timeout";
      cause?: ZoomFailureCause;
      snapshotError?: SnapshotError;
    }
  | {
      phase: Phase;
      reason: "attempt-failed";
      message: string;
      cause: ZoomFailureCause;
    };

export type RuntimeZoomAttempt = {
  target: number;
  before: ZoomSnapshotRead | null;
  final: ZoomSnapshotRead | null;
  expectedBefore: ReturnType<typeof measureRuntimeZoom>;
  finalMeasurement: ReturnType<typeof measureRuntimeZoom>;
  elapsedMs: number;
  arrived: boolean;
  error: AttemptError | null;
  cleanup: CleanupOutcome;
  readCleanup: CleanupOutcome[];
};

class SnapshotReadError extends Error {
  constructor(readonly failure: SnapshotError) {
    super(failure.message ?? failure.reason);
  }
}

function availableSnapshot(read: ZoomSnapshotRead | null) {
  return read?.status === "available" ? read.snapshot : null;
}

export async function runRuntimeZoomAttempt(
  target: number,
  io: {
    read: (
      deadline: number,
      trackCleanup: (run: () => Promise<unknown>) => void,
    ) => Promise<ZoomSnapshotRead>;
    apply: (deadline: number) => Promise<void>;
    wait: (milliseconds: number) => Promise<unknown>;
    cleanup: () => Promise<unknown>;
    now?: () => number;
    isTimeout?: (cause: unknown) => boolean;
  },
): Promise<RuntimeZoomAttempt> {
  const now = io.now ?? Date.now;
  const startedAt = now();
  const deadline = startedAt + 10_000;
  let phase: Phase = "baseline";
  let before: ZoomSnapshotRead | null = null;
  let final: ZoomSnapshotRead | null = null;
  let arrived = false;
  let error: AttemptError | null = null;
  let cleanupOutcome: CleanupOutcome = { status: "not-requested" };
  const readCleanup: CleanupOutcome[] = [];
  const describeCause = (cause: unknown): ZoomFailureCause => ({
    type: io.isTimeout?.(cause) ? "timeout" : "error",
    name: cause instanceof Error ? cause.name : typeof cause,
    message: String(cause),
  });
  const observation: {
    pending: "baseline" | "settle" | null;
    closed: boolean;
  } = {
    pending: null,
    closed: false,
  };
  const trackCleanup = (
    run: () => Promise<unknown>,
    update: (outcome: CleanupOutcome) => void,
  ) => {
    const publish = (outcome: CleanupOutcome) => {
      if (!observation.closed) update(outcome);
    };
    publish({ status: "pending" });
    // Failed operations must remain observable even if resource cleanup stalls.
    try {
      void run().then(
        () => {
          publish({ status: "completed" });
        },
        (cause) => {
          publish({ status: "failed", cause: describeCause(cause) });
        },
      );
    } catch (cause) {
      publish({ status: "failed", cause: describeCause(cause) });
    }
  };
  const cleanup = async () =>
    trackCleanup(io.cleanup, (outcome) => {
      cleanupOutcome = outcome;
    });
  const read = async (stage: "baseline" | "settle") => {
    observation.pending = stage;
    let result: ZoomSnapshotRead;
    try {
      result = await io.read(deadline, (run) => {
        const index = readCleanup.length;
        trackCleanup(run, (outcome) => {
          readCleanup[index] = outcome;
        });
      });
    } catch (cause) {
      const detail = describeCause(cause);
      result = {
        status: "error",
        reason:
          detail.type === "timeout"
            ? "snapshot-read-timed-out"
            : "snapshot-read-failed",
        message: detail.message,
        cause: detail,
      };
    }
    if (observation.closed) return null;
    observation.pending = null;
    if (stage === "baseline") before = result;
    else final = result;
    if (result.status === "error") throw new SnapshotReadError(result);
    return availableSnapshot(result);
  };
  try {
    const baseline = await readZoomUntilAvailable(
      async () => {
        const snapshot = await read("baseline");
        return measureRuntimeZoom(snapshot, target).expectedScale;
      },
      io.wait,
      deadline,
      cleanup,
      now,
    );
    if (baseline === null) error = { phase, reason: "deadline-exceeded" };
    else {
      phase = "apply";
      await io.apply(deadline);
      if (now() >= deadline) error = { phase, reason: "deadline-exceeded" };
      else {
        phase = "settle";
        const actual = await readZoomUntilAvailable(
          async () => {
            const snapshot = await read("settle");
            return measureRuntimeZoom(snapshot, target).failedChecks.length ===
              0
              ? snapshot!.camera.scale
              : null;
          },
          io.wait,
          deadline,
          cleanup,
          now,
        );
        arrived = actual !== null;
        if (!arrived) error = { phase, reason: "deadline-exceeded" };
      }
    }
  } catch (cause) {
    const snapshotError =
      cause instanceof SnapshotReadError ? cause.failure : undefined;
    const detail = snapshotError?.cause ?? describeCause(cause);
    if (detail.type === "timeout") {
      error = {
        phase,
        reason: now() >= deadline ? "deadline-exceeded" : "operation-timeout",
        cause: detail,
        ...(snapshotError ? { snapshotError } : {}),
      };
    } else if (snapshotError) {
      error = { phase, reason: "snapshot-error", snapshotError };
    } else {
      error = {
        phase,
        reason: "attempt-failed",
        message: detail.message,
        cause: detail,
      };
    }
  }
  // Cleanup need not settle the browser promise; its eventual outcome is unknown.
  if (observation.pending !== null) {
    const timedOut: SnapshotError = {
      status: "error",
      reason: "snapshot-read-timed-out",
    };
    if (observation.pending === "baseline") before = timedOut;
    else final = timedOut;
  }
  observation.closed = true;
  return {
    target,
    before,
    final,
    expectedBefore: measureRuntimeZoom(availableSnapshot(before), target),
    finalMeasurement: measureRuntimeZoom(availableSnapshot(final), target),
    elapsedMs: now() - startedAt,
    arrived,
    error,
    cleanup: cleanupOutcome,
    readCleanup,
  };
}
