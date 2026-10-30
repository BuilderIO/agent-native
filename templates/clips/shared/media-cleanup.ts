import { z } from "zod";

export const mediaCleanupStatusSchema = z.enum([
  "pending",
  "blocked",
  "complete",
  "retained_shared",
]);

export const mediaCleanupSummarySchema = z.object({
  id: z.string(),
  recordingId: z.string(),
  status: mediaCleanupStatusSchema,
  pending: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
  retained: z.number().int().nonnegative(),
  external: z.number().int().nonnegative().optional(),
  reason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type MediaCleanupSummary = z.infer<typeof mediaCleanupSummarySchema>;
