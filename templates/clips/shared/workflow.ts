import { z } from "zod";

export const WORKFLOW_KINDS = ["pr", "sop", "ticket", "email"] as const;
export const WorkflowKindSchema = z.enum(WORKFLOW_KINDS);
export type WorkflowKind = z.infer<typeof WorkflowKindSchema>;

export function matchesWorkflowRequest(
  current: { requestId?: unknown; requestedAt?: unknown },
  expected: { requestId?: string | undefined; requestedAt: string },
) {
  return expected.requestId
    ? current.requestId === expected.requestId
    : !current.requestId && current.requestedAt === expected.requestedAt;
}
