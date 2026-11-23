import { z } from "zod";

import { sectionDescendantIds } from "./notebook-sections.js";
import {
  absentSchema,
  authorizedNotebookSnapshotRefSchema,
  decimalIntegerSchema,
  deniedSchema,
  notebookCellIdSchema,
  outputFenceSchema,
  pendingSchema,
  revisionSchema,
  unreadableSchema,
} from "./notebook-snapshot-contract.js";

export const CONTRACT_VERSION = 1;

export const namespaceIdSchema = z.string().min(1).brand<"RunNamespaceId">();
export const runIdSchema = z.string().min(1).brand<"RunId">();
export const attemptIdSchema = z.string().min(1).brand<"AttemptId">();
export const resultIdSchema = z.string().min(1).brand<"ResultId">();
export const kernelGenerationSchema =
  decimalIntegerSchema.brand<"KernelGeneration">();
export const releaseIdSchema = z.string().min(1).brand<"ReleaseId">();
export const appSessionIdSchema = z.string().min(1).brand<"AppSessionId">();
const runEventCursorSchema = decimalIntegerSchema.brand<"RunEventCursor">();
const namespace = z.strictObject({ namespaceId: namespaceIdSchema });
const releaseNamespace = namespace.extend({ releaseId: releaseIdSchema });

export const runNamespaceSchema = z.discriminatedUnion("kind", [
  namespace.extend({ kind: z.literal("draft") }),
  namespace.extend({
    kind: z.literal("thread"),
    threadId: z.string().min(1).brand<"ThreadId">(),
  }),
  namespace.extend({
    kind: z.literal("preview"),
    previewId: z.string().min(1).brand<"PreviewId">(),
  }),
  releaseNamespace.extend({
    kind: z.literal("release-session"),
    sessionId: appSessionIdSchema,
  }),
  releaseNamespace.extend({ kind: z.literal("release-default") }),
  releaseNamespace.extend({
    kind: z.literal("schedule-tick"),
    tickId: z.string().min(1).brand<"ScheduleTickId">(),
  }),
]);

export const executionSnapshotSchema = z.strictObject({
  ref: authorizedNotebookSnapshotRefSchema,
  namespace: runNamespaceSchema,
  inputRevision: revisionSchema,
  executionFingerprint: z.string().min(1),
});

const runRequest = z.strictObject({
  snapshot: executionSnapshotSchema,
  requestId: z.string().min(1).brand<"RunRequestId">(),
  cache: z.enum(["reuse", "bypass"]),
});

const targetedRunRequest = runRequest.extend({
  targetCellId: notebookCellIdSchema,
  staleValues: z.enum(["reject", "allow-compatible"]),
});

export const runRequestSchema = z.discriminatedUnion("mode", [
  targetedRunRequest.extend({
    mode: z.enum(["cell-only", "upstream", "downstream", "auto"]),
  }),
  runRequest.extend({
    mode: z.literal("run-all"),
    restart: z.boolean(),
  }),
  targetedRunRequest.extend({ mode: z.literal("run-section") }),
]);

export const runSectionCellSchema = z.strictObject({
  id: z.string().min(1),
  contents: z.strictObject({
    kind: z.literal("collapsible"),
    collapsed: z.boolean(),
    parentSectionId: z.string().min(1).nullish(),
  }),
});
export type RunSectionCell = z.infer<typeof runSectionCellSchema>;

export function sectionRunTargets(
  cells: readonly {
    id: string;
    contents: { kind: string; parentSectionId?: string | null | undefined };
  }[],
  sections: readonly RunSectionCell[],
  sectionId: string,
) {
  if (!sections.some(({ id }) => id === sectionId)) return undefined;
  return new Set(sectionDescendantIds([...cells, ...sections], sectionId));
}

export const runInvalidationSchema = z.strictObject({
  snapshot: authorizedNotebookSnapshotRefSchema,
  namespace: runNamespaceSchema,
  inputRevision: revisionSchema,
  cause: z.enum([
    "edit",
    "clear",
    "delete",
    "restore",
    "input-change",
    "kernel-reset",
  ]),
  outputs: z.array(outputFenceSchema),
});

export const attemptIdentitySchema = outputFenceSchema.extend({
  namespaceId: namespaceIdSchema,
  runId: runIdSchema,
  attemptId: attemptIdSchema,
});

const cellRunStateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.enum(["queued", "running", "cancelled"]) }),
  z.strictObject({
    status: z.literal("complete"),
    resultIds: z.array(resultIdSchema),
  }),
  z.strictObject({
    status: z.literal("failed"),
    reason: z.enum([
      "execution_failed",
      "interrupted",
      "provider_outcome_unknown",
    ]),
  }),
  z.strictObject({
    status: z.literal("blocked"),
    reason: z.literal("cancelled_upstream"),
    blockedBy: notebookCellIdSchema,
  }),
]);

export const cellRunReceiptSchema = z.strictObject({
  attempt: attemptIdentitySchema,
  state: cellRunStateSchema,
});

export const runPlanSchema = z.strictObject({
  admittedCellIds: z.array(notebookCellIdSchema),
  dependencyResultIds: z.array(resultIdSchema),
  rejectedCells: z.array(
    z.strictObject({
      cellId: notebookCellIdSchema,
      reason: z.enum([
        "parse_error",
        "missing_prerequisite",
        "incompatible_prerequisite",
      ]),
    }),
  ),
});

export const runReceiptSchema = z.strictObject({
  status: z.literal("admitted"),
  runId: runIdSchema,
  request: runRequestSchema,
  startedAt: z.iso.datetime({ offset: true }),
  plan: runPlanSchema,
  attempts: z.array(cellRunReceiptSchema),
  cursor: runEventCursorSchema,
});

export const runAdmissionSchema = z.discriminatedUnion("status", [
  runReceiptSchema,
  absentSchema,
  unreadableSchema,
  deniedSchema,
  pendingSchema,
  z.strictObject({
    status: z.literal("rejected"),
    reason: z.enum([
      "request_id_reused",
      "stale_snapshot",
      "unsupported_request",
    ]),
  }),
]);

const runCancellationOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("cancelled"),
    reason: z.literal("cancel_confirmed"),
  }),
  z.strictObject({
    status: z.literal("completed"),
    reason: z.literal("completion_won"),
  }),
  z.strictObject({
    status: z.literal("unknown"),
    reason: z.literal("provider_outcome_unknown"),
  }),
]);

export const runCancellationSchema = z.discriminatedUnion("status", [
  runCancellationOutcomeSchema,
  absentSchema,
  unreadableSchema,
  deniedSchema,
  pendingSchema,
]);

export const runEventSchema = z.strictObject({
  runId: runIdSchema,
  sequence: runEventCursorSchema,
  event: z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("attempt"),
      receipt: cellRunReceiptSchema,
    }),
    z.strictObject({
      type: z.literal("cancellation"),
      outcome: runCancellationOutcomeSchema,
    }),
  ]),
});

export type RunNamespace = z.infer<typeof runNamespaceSchema>;
export type Snapshot = z.infer<typeof executionSnapshotSchema>;
export type RunRequest = z.infer<typeof runRequestSchema>;
export type RunPlan = z.infer<typeof runPlanSchema>;
export type RunReceipt = z.infer<typeof runReceiptSchema>;
export type RunAdmission = z.infer<typeof runAdmissionSchema>;
export type RunInvalidation = z.infer<typeof runInvalidationSchema>;
export type AttemptIdentity = z.infer<typeof attemptIdentitySchema>;
export type CellRunReceipt = z.infer<typeof cellRunReceiptSchema>;
export type RunCancellation = z.infer<typeof runCancellationSchema>;
export type RunEvent = z.infer<typeof runEventSchema>;
