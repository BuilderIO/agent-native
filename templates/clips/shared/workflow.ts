import { z } from "zod";

export const WORKFLOW_KINDS = ["pr", "sop", "ticket", "email"] as const;
export const WorkflowKindSchema = z.enum(WORKFLOW_KINDS);
export type WorkflowKind = z.infer<typeof WorkflowKindSchema>;
