import { z } from "zod";

export const columnFillCellStatusOutput = z.enum([
  "waiting",
  "running",
  "filled",
  "kept",
  "failed",
  "skipped",
]);

export const columnFillOutput = z.object({
  id: z.string(),
  databaseId: z.string(),
  propertyId: z.string(),
  instruction: z.string(),
  rewrite: z.boolean(),
  status: z.enum(["running", "stopping", "stopped", "done"]),
  total: z.number(),
  settled: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  cells: z.array(
    z.object({
      documentId: z.string(),
      status: columnFillCellStatusOutput,
      agentThreadId: z.string().nullable(),
      error: z.string().nullable(),
    }),
  ),
});
