import { z } from "zod";

export const AI_FILTER_BACKFILL_MAX_THREADS = 200;
export const AI_FILTER_BACKFILL_WINDOW_DAYS = 14;
export const AI_FILTER_BACKFILL_MAX_RULES = 32;

export const aiFilterBackfillPreviewSchema = z.object({
  id: z.string().min(1).max(256),
  from: z.string().max(320),
  subject: z.string().max(500),
  labels: z.array(z.string().max(128)).max(64),
  archived: z.boolean(),
});

export const aiFilterBackfillRuleProgressSchema = z.object({
  ruleId: z.string().min(1).max(64),
  name: z.string().max(200),
  matchedCount: z.number().int().nonnegative(),
  appliedCount: z.number().int().nonnegative(),
  suggestedCount: z.number().int().nonnegative(),
  previews: z.array(aiFilterBackfillPreviewSchema).max(5),
});

export const aiFilterBackfillStatusSchema = z.object({
  runId: z.string().min(1).max(64),
  status: z.enum([
    "queued",
    "running",
    "completed",
    "failed",
    "undoing",
    "undone",
  ]),
  totalThreads: z.number().int().nonnegative(),
  processedThreads: z.number().int().nonnegative(),
  matchedThreads: z.number().int().nonnegative(),
  appliedThreads: z.number().int().nonnegative(),
  failedThreads: z.number().int().nonnegative(),
  restoredThreads: z.number().int().nonnegative().optional(),
  undoFailures: z.number().int().nonnegative().optional(),
  perRule: z.array(aiFilterBackfillRuleProgressSchema),
  undoToken: z.string().min(1).optional(),
  error: z.string().max(500).optional(),
});

export const manageAiFilterBackfillInputSchema = z.discriminatedUnion(
  "operation",
  [
    z.object({
      operation: z.literal("start"),
      ruleIds: z
        .array(z.string().min(1).max(64))
        .min(1)
        .max(AI_FILTER_BACKFILL_MAX_RULES)
        .optional(),
    }),
    z.object({
      operation: z.literal("status"),
      runId: z.string().min(1).max(64),
    }),
    z.object({ operation: z.literal("recent") }),
    z.object({
      operation: z.literal("undo"),
      runId: z.string().min(1).max(64),
      undoToken: z.string().min(1).max(64),
    }),
  ],
);

export type AiFilterBackfillPreview = z.infer<
  typeof aiFilterBackfillPreviewSchema
>;
export type AiFilterBackfillRuleProgress = z.infer<
  typeof aiFilterBackfillRuleProgressSchema
>;
export type AiFilterBackfillStatus = z.infer<
  typeof aiFilterBackfillStatusSchema
>;
export type ManageAiFilterBackfillInput = z.infer<
  typeof manageAiFilterBackfillInputSchema
>;

export type AiFilterBackfillStartResult = {
  runId: string;
  status: "queued";
};

export type AiFilterBackfillUndoResult = {
  runId: string;
  status: "undoing";
};
