import { z } from "zod";

import { notebookSnapshotSchema } from "./notebook-operations.js";
import {
  notebookProjectIdSchema,
  notebookVersionIdSchema,
} from "./notebook-snapshot-contract.js";

export const creationRequestSchema = z.strictObject({ requestId: z.uuid() });

export const creationReceiptSchema = creationRequestSchema.extend({
  projectId: notebookProjectIdSchema,
  workingVersionId: notebookVersionIdSchema,
  snapshot: notebookSnapshotSchema,
  committedAt: z.iso.datetime(),
  href: z.string().min(1),
  id: notebookProjectIdSchema,
});

export const projectCreationSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("absent") }),
  z.strictObject({
    status: z.literal("committed"),
    receipt: creationReceiptSchema,
  }),
]);

export type CreationReceipt = z.infer<typeof creationReceiptSchema>;
