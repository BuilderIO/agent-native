import { z } from "zod";

import { cellIdSchema, projectIdSchema } from "../app/lib/model/contracts.js";

export const CONTRACT_VERSION = 1;

export const workspaceIdSchema = z.string().min(1).brand<"WorkspaceId">();
export const notebookProjectIdSchema = projectIdSchema.brand<"ProjectId">();
export const notebookCellIdSchema = cellIdSchema.brand<"CellId">();
export const notebookVersionIdSchema = z
  .string()
  .min(1)
  .brand<"NotebookVersionId">();
export const decimalIntegerSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const revisionSchema = decimalIntegerSchema.brand<"Revision">();
export const notebookEventCursorSchema =
  decimalIntegerSchema.brand<"NotebookEventCursor">();

export type Revision = z.infer<typeof revisionSchema>;

export const draftHeadSchema = z.strictObject({
  versionId: notebookVersionIdSchema,
  revision: revisionSchema,
});

export const authorizedNotebookSnapshotRefSchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  projectId: notebookProjectIdSchema,
  head: draftHeadSchema,
  eventSeq: notebookEventCursorSchema,
});

export const outputFenceSchema = z.strictObject({
  cellId: notebookCellIdSchema,
  outputGeneration: z.string().min(1).brand<"OutputGeneration">(),
});

export const notebookCommandImpactSchema = z.strictObject({
  opId: z.string().min(1).brand<"NotebookOperationId">(),
  previousHead: draftHeadSchema,
  snapshot: authorizedNotebookSnapshotRefSchema,
  changedCellIds: z.array(notebookCellIdSchema),
  invalidatedOutputs: z.array(outputFenceSchema),
});

export const absentSchema = z.strictObject({
  status: z.literal("absent"),
  reason: z.literal("not_found"),
});
export const unreadableSchema = z.strictObject({
  status: z.literal("unreadable"),
  reason: z.literal("read_failed"),
});
export const deniedSchema = z.strictObject({
  status: z.literal("denied"),
  reason: z.literal("access_denied"),
});
export const pendingSchema = z.strictObject({
  status: z.literal("pending"),
  reason: z.literal("not_ready"),
});

export const notebookSnapshotResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("accepted"),
    snapshot: authorizedNotebookSnapshotRefSchema,
  }),
  absentSchema,
  unreadableSchema,
  deniedSchema,
]);

export type DraftHead = z.infer<typeof draftHeadSchema>;
export type AuthorizedNotebookSnapshotRef = z.infer<
  typeof authorizedNotebookSnapshotRefSchema
>;
export type NotebookCommandImpact = z.infer<typeof notebookCommandImpactSchema>;
export type NotebookSnapshotResult = z.infer<
  typeof notebookSnapshotResultSchema
>;
