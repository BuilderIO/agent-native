import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getNotebookTransform } from "../server/model/notebook-transforms.js";
import { appSessionIdSchema } from "../shared/notebook-execution.js";
import { notebookTransformSchema } from "../shared/visualization-contracts.js";

export default defineAction({
  description:
    "Read a saved Chart, Pivot, or Single value over a complete notebook result. Use the returned producer and field IDs to configure the cell. Charts and Pivots also return visualization and selection IDs for drilling.",
  schema: z.strictObject({
    projectId: z.string().min(1).describe("The notebook project ID."),
    cellId: z.string().min(1).describe("The saved visualization cell ID."),
    mode: z.enum(["chart", "pivot", "metric"]).optional(),
    releaseId: z.string().min(1).optional(),
    sessionId: appSessionIdSchema.optional(),
    previewId: z.string().min(1).optional(),
    rowPage: z.coerce.number().pipe(z.int().min(1).max(200)).optional(),
    columnPage: z.coerce.number().pipe(z.int().min(1).max(100)).optional(),
    expectedConfigRevision: z
      .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
      .pipe(z.int().nonnegative())
      .optional(),
    expectedVersionId: z
      .string()
      .min(1)
      .optional()
      .describe("The working version ID held by the caller."),
  }),
  outputSchema: notebookTransformSchema,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: (input, context) =>
    getNotebookTransform(input, context?.caller ?? "frontend"),
});
