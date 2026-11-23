import { z } from "zod";

import { tableOutputSchema } from "../app/lib/model/contracts.js";
import {
  attemptIdentitySchema,
  kernelGenerationSchema,
  resultIdSchema,
} from "./notebook-execution.js";
import {
  absentSchema,
  authorizedNotebookSnapshotRefSchema,
  decimalIntegerSchema,
  deniedSchema,
  pendingSchema,
  revisionSchema,
  unreadableSchema,
} from "./notebook-snapshot-contract.js";

export const CONTRACT_VERSION = 1;

export const authorizedResultRefSchema = z.strictObject({
  resultId: resultIdSchema,
  snapshot: authorizedNotebookSnapshotRefSchema,
  producer: attemptIdentitySchema.extend({
    exportId: z.string().min(1).brand<"ResultExportId">(),
  }),
  inputRevision: revisionSchema,
  dependencyFingerprint: z.string().min(1),
  kernelGeneration: kernelGenerationSchema.nullable(),
  provenance: z.literal("browser").optional(),
  sourceGeneration: decimalIntegerSchema.brand<"SourceGeneration">().nullable(),
});

const fieldTypeSchema = tableOutputSchema.shape.columns.element.shape.type;
export const resultFieldSchema = z.strictObject({
  fieldId: z.string().min(1).brand<"ResultFieldId">(),
  name: z.string(),
  type: z.enum([
    ...fieldTypeSchema.options,
    "decimal",
    "integer",
    "binary",
    "list",
    "struct",
    "time",
    "json",
  ]),
  nullable: z.boolean(),
});

const manifest = z.strictObject({
  result: authorizedResultRefSchema,
  fields: z.array(resultFieldSchema),
});
const complete = manifest.extend({
  status: z.literal("complete"),
  rowCount: decimalIntegerSchema.refine((count) => count !== "0"),
});
const completeEmpty = manifest.extend({
  status: z.literal("complete-empty"),
  rowCount: z.literal("0"),
});
const incomplete = manifest.extend({
  status: z.literal("incomplete"),
  reason: z.enum(["truncated", "sampled", "coverage_unverified"]),
  verifiedRowCount: decimalIntegerSchema,
});
const pending = manifest.extend({
  ...pendingSchema.shape,
  verifiedRowCount: decimalIntegerSchema,
});

export const completeResultManifestSchema = z.discriminatedUnion("status", [
  complete,
  completeEmpty,
]);

export const resultManifestSchema = z.discriminatedUnion("status", [
  completeResultManifestSchema,
  incomplete,
  pending,
]);

export const notebookResultReadSchema = z.discriminatedUnion("status", [
  resultManifestSchema,
  absentSchema,
  unreadableSchema,
  deniedSchema,
]);

export type AuthorizedResultRef = z.infer<typeof authorizedResultRefSchema>;
export type ResultField = z.infer<typeof resultFieldSchema>;
export type CompleteResultManifest = z.infer<
  typeof completeResultManifestSchema
>;
export type ResultManifest = z.infer<typeof resultManifestSchema>;
export type NotebookResultRead = z.infer<typeof notebookResultReadSchema>;
