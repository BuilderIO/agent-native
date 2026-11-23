import { z } from "zod";

import { cellContentsSchema } from "../app/lib/model/contracts.js";
import { runReceiptSchema } from "./notebook-execution.js";
import {
  draftHeadSchema,
  revisionSchema,
} from "./notebook-snapshot-contract.js";
import { projectDocumentWithLayoutSchema } from "./project-document.js";

const id = z.string().min(1);
const intent = z.uuid();
const project = z.strictObject({ projectId: id });

export const createPublishPreviewInput = project.extend({
  expectedHead: draftHeadSchema,
  expectedReleaseId: id.nullable(),
  requestId: intent,
});

export const publishPreviewReceiptSchema = project.extend({
  previewId: id,
  head: draftHeadSchema,
  compareReleaseId: id.nullable(),
  runId: id.nullable(),
  state: z.enum([
    "queued",
    "running",
    "ready",
    "failed",
    "cancelled",
    "published",
  ]),
  cursor: revisionSchema,
});

export const getPublishPreviewInput = project.extend({
  previewId: id,
  after: revisionSchema.optional(),
  diffAfter: id.optional(),
});

export const releaseOutputSchema = z.discriminatedUnion("state", [
  z.strictObject({
    cellId: id,
    state: z.literal("ready"),
    resultId: id,
    diagnosticId: z.null(),
  }),
  z.strictObject({
    cellId: id,
    state: z.enum(["failed", "missing"]),
    resultId: z.null(),
    diagnosticId: id.nullable(),
  }),
]);

export const publishPreviewDetailSchema = publishPreviewReceiptSchema.extend({
  manifestRevision: revisionSchema,
  manifestId: id,
  project: projectDocumentWithLayoutSchema,
  compared: z
    .strictObject({
      description: z.string().nullable(),
      publishedAt: z.string(),
      project: projectDocumentWithLayoutSchema,
    })
    .nullable(),
  diff: z.array(
    z.strictObject({
      cellId: id,
      changes: z.array(
        z.enum(["added", "removed", "reordered", "config-changed"]),
      ),
      current: cellContentsSchema.nullable(),
      previous: cellContentsSchema.nullable(),
    }),
  ),
  nextDiffCursor: id.nullable(),
  outputs: z.array(releaseOutputSchema),
  run: runReceiptSchema.nullable(),
});

export const cancelPublishPreviewInput = project.extend({
  createRequestId: intent,
  requestId: intent,
});

export const cancelPublishPreviewReceiptSchema = z.strictObject({
  previewId: id.optional(),
  state: z.enum(["cancelled", "published", "already_cancelled"]),
  cursor: revisionSchema,
});

export const publishProjectInput = createPublishPreviewInput.extend({
  previewId: id,
  expectedManifestRevision: revisionSchema,
  description: z.string().max(2000).optional(),
  mode: z.enum(["ready", "accept-errors", "force"]),
});

export const publishProjectReceiptSchema = z.strictObject({
  releaseId: id,
  releaseNumber: z.string().min(1),
  head: draftHeadSchema,
  manifestId: id,
  publishedAt: z.string(),
  appHref: z.string().min(1),
  releaseHref: z.string().min(1),
});

export type ReleaseOutput = z.infer<typeof releaseOutputSchema>;
export type PublishPreviewReceipt = z.infer<typeof publishPreviewReceiptSchema>;
export type PublishPreviewDetail = z.infer<typeof publishPreviewDetailSchema>;
export type CancelPublishPreviewReceipt = z.infer<
  typeof cancelPublishPreviewReceiptSchema
>;
export type PublishProjectReceipt = z.infer<typeof publishProjectReceiptSchema>;
