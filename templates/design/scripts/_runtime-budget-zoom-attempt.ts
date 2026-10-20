import type { ZoomSnapshotRead } from "./_runtime-budget-zoom-snapshot";
import {
  measureRuntimeZoom,
  readZoomUntilAvailable,
} from "./runtime-budget-zoom";

type Phase = "baseline" | "apply" | "settle";
type SnapshotError = Extract<ZoomSnapshotRead, { status: "error" }>;

type AttemptError =
  | { phase: Phase; reason: "snapshot-error"; snapshotError: SnapshotError }
  | { phase: Phase; reason: "deadline-exceeded" }
  | { phase: Phase; reason: "attempt-failed"; message: string };

export type RuntimeZoomAttempt = {
  target: number;
  before: ZoomSnapshotRead | null;
  final: ZoomSnapshotRead | null;
  expectedBefore: ReturnType<typeof measureRuntimeZoom>;
  finalMeasurement: ReturnType<typeof measureRuntimeZoom>;
  elapsedMs: number;
  arrived: boolean;
  error: AttemptError | null;
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
    read: (deadline: number) => Promise<ZoomSnapshotRead>;
    apply: (deadline: number) => Promise<void>;
    wait: (milliseconds: number) => Promise<unknown>;
    cleanup: () => Promise<unknown>;
    now?: () => number;
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
  const observation: {
    pending: "baseline" | "settle" | null;
    closed: boolean;
  } = {
    pending: null,
    closed: false,
  };
  const read = async (stage: "baseline" | "settle") => {
    observation.pending = stage;
    let result: ZoomSnapshotRead;
    try {
      result = await io.read(deadline);
    } catch (cause) {
      result = {
        status: "error",
        reason: "snapshot-read-failed",
        message: String(cause),
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
      io.cleanup,
      now,
    );
    if (baseline === null) error = { phase, reason: "deadline-exceeded" };
    else {
      phase = "apply";
      await io.apply(deadline);
      phase = "settle";
      const actual = await readZoomUntilAvailable(
        async () => {
          const snapshot = await read("settle");
          return measureRuntimeZoom(snapshot, target).failedChecks.length === 0
            ? snapshot!.camera.scale
            : null;
        },
        io.wait,
        deadline,
        io.cleanup,
        now,
      );
      arrived = actual !== null;
      if (!arrived) error = { phase, reason: "deadline-exceeded" };
    }
  } catch (cause) {
    error =
      cause instanceof SnapshotReadError
        ? { phase, reason: "snapshot-error", snapshotError: cause.failure }
        : { phase, reason: "attempt-failed", message: String(cause) };
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
  };
}
