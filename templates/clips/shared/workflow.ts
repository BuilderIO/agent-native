import { z } from "zod";

export const WORKFLOW_KINDS = ["pr", "sop", "ticket", "email"] as const;
export const WorkflowKindSchema = z.enum(WORKFLOW_KINDS);
export type WorkflowKind = z.infer<typeof WorkflowKindSchema>;

const WORKFLOW_GENERATION_STALE_AFTER_MS = 10 * 60_000;
export const WORKFLOW_GENERATION_PROGRESS_MS = {
  stillGenerating: 30_000,
  takingLonger: 2 * 60_000,
} as const;

export function workflowSessionTabId(
  recordingId: string,
  requestedAt: string,
  requestId?: string,
) {
  const identity = requestId
    ? `${encodeURIComponent(requestedAt)}:${encodeURIComponent(requestId)}`
    : encodeURIComponent(requestedAt);
  return `clips-workflow:${recordingId}:${identity}:run`;
}

export function workflowGenerationStaleAt(
  state: { status?: unknown; requestedAt?: unknown } | null | undefined,
): number | null {
  if (state?.status !== "generating") return null;
  const requestedAt = Date.parse(
    typeof state.requestedAt === "string" ? state.requestedAt : "",
  );
  return Number.isFinite(requestedAt)
    ? requestedAt + WORKFLOW_GENERATION_STALE_AFTER_MS
    : null;
}

export function workflowGenerationProgressAt(
  state: { status?: unknown; requestedAt?: unknown } | null | undefined,
  now = Date.now(),
): "still_generating" | "taking_longer" | null {
  if (state?.status !== "generating") return null;
  const requestedAt = Date.parse(
    typeof state.requestedAt === "string" ? state.requestedAt : "",
  );
  if (!Number.isFinite(requestedAt)) return null;

  const elapsed = now - requestedAt;
  if (elapsed >= WORKFLOW_GENERATION_PROGRESS_MS.takingLonger) {
    return "taking_longer";
  }
  if (elapsed >= WORKFLOW_GENERATION_PROGRESS_MS.stillGenerating) {
    return "still_generating";
  }
  return null;
}

export function isRecentWorkflowGeneration(
  state: { status?: unknown; requestedAt?: unknown } | null | undefined,
  now = Date.now(),
): boolean {
  if (state?.status !== "generating") return false;
  const staleAt = workflowGenerationStaleAt(state);
  return staleAt !== null && now < staleAt;
}

export function matchesWorkflowRequest(
  current: { requestId?: unknown; requestedAt?: unknown },
  expected: { requestId?: string | undefined; requestedAt: string },
) {
  return (
    current.requestedAt === expected.requestedAt &&
    (expected.requestId
      ? current.requestId === expected.requestId
      : !current.requestId)
  );
}

export const WORKFLOW_STOP_MAX_ATTEMPTS = 5;

export function shouldRetryWorkflowStop(
  error: unknown,
  failedAttempts: number,
): boolean {
  if (failedAttempts >= WORKFLOW_STOP_MAX_ATTEMPTS) return false;
  if (!(error instanceof Error)) return true;
  const status = (error as Error & { status?: unknown }).status;
  return (
    typeof status !== "number" ||
    status >= 500 ||
    [408, 409, 425, 429].includes(status)
  );
}
