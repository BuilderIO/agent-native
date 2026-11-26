export const CAPTURE_HOST_LEASE_MS = 10_000;
export const MAX_CAPTURE_DURATION_MS = 120_000;
export const CAPTURE_STARTUP_BUDGET_MS = 30_000;
export const MAX_CAPTURE_MARKERS = 200;

export type CaptureState =
  | "queued"
  | "starting"
  | "beginning"
  | "recording"
  | "stop-requested"
  | "finalizing"
  | "complete"
  | "failed"
  | "cancelled";

export type CaptureOutcome = "complete" | "failed" | "cancelled";

export interface MotionCaptureSession {
  id: string;
  hostId: string;
  captureMode: "normal" | "motion";
  maxDurationMs: number;
  state: CaptureState;
  recordingId: string | null;
  startedAtMs: number | null;
  startUncertaintyMs: number | null;
  observedFrameRate: number | null;
  error: string | null;
}

export interface MotionCaptureMarker {
  id: string;
  label: string;
  kind: "action-intent" | "observed-endpoint" | "note";
  requestedAt: string;
  mediaTimeMs: number | null;
  uncertaintyMs: number | null;
}

export function isCaptureTerminal(state: string): boolean {
  return state === "complete" || state === "failed" || state === "cancelled";
}

export function isCaptureReadyAccepted(
  session: { state?: unknown; startedAtMs?: unknown } | null | undefined,
): boolean {
  return (
    !!session &&
    typeof session.startedAtMs === "number" &&
    typeof session.state === "string" &&
    !isCaptureTerminal(session.state)
  );
}

export function assertCaptureTransition(from: string, to: string): void {
  const allowed: Record<string, readonly string[]> = {
    queued: ["starting", "stop-requested", "failed", "cancelled"],
    starting: ["beginning", "stop-requested", "failed", "cancelled"],
    beginning: ["recording", "stop-requested", "failed", "cancelled"],
    recording: ["stop-requested", "finalizing", "failed", "cancelled"],
    "stop-requested": ["finalizing", "complete", "failed", "cancelled"],
    finalizing: ["complete", "failed"],
    complete: [],
    failed: [],
    cancelled: [],
  };
  if (from !== to && !allowed[from]?.includes(to)) {
    throw new Error(`Invalid capture transition: ${from} -> ${to}`);
  }
}
