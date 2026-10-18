import { z } from "zod";

export const WORKFLOW_KINDS = ["pr", "sop", "ticket", "email"] as const;
export const WorkflowKindSchema = z.enum(WORKFLOW_KINDS);
export type WorkflowKind = z.infer<typeof WorkflowKindSchema>;

const WORKFLOW_GENERATION_STALE_AFTER_MS = 10 * 60_000;

export function isRecentWorkflowGeneration(
  state: { status?: unknown; requestedAt?: unknown } | null | undefined,
  now = Date.now(),
): boolean {
  if (state?.status !== "generating") return false;
  const requestedAt = Date.parse(
    typeof state.requestedAt === "string" ? state.requestedAt : "",
  );
  return (
    !Number.isFinite(requestedAt) ||
    now - requestedAt < WORKFLOW_GENERATION_STALE_AFTER_MS
  );
}

export function matchesWorkflowRequest(
  current: { requestId?: unknown; requestedAt?: unknown },
  expected: { requestId?: string | undefined; requestedAt: string },
) {
  return expected.requestId
    ? current.requestId === expected.requestId
    : !current.requestId && current.requestedAt === expected.requestedAt;
}
