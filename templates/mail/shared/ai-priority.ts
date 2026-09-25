import { z } from "zod";

import { aiFilterPreviewEmailSchema } from "./ai-filter.js";

export const AI_IMPORTANT_LABEL = "agent-native-important";
export const AI_PRIORITY_MAX_EMAILS = 500;
export const AI_PRIORITY_DEFAULT_INSTRUCTION =
  "Prioritize emails that need a reply, contain a deadline or next step, or come from an important relationship. Lower priority for newsletters, receipts, and automated notifications.";
export type MailSortMode = "newest" | "priority";

export const aiPriorityEmailSchema = aiFilterPreviewEmailSchema;
export type AiPriorityEmail = z.infer<typeof aiPriorityEmailSchema>;

export const aiPriorityScoreSchema = z.object({
  emailId: z.string().min(1).max(256),
  accountEmail: z.string().email().optional(),
  score: z.number().min(0).max(1),
  reason: z.string().max(500).optional(),
});
export type AiPriorityScore = z.infer<typeof aiPriorityScoreSchema>;

export function aiPriorityEmailKey(
  accountEmail: string | undefined,
  emailId: string,
): string {
  return JSON.stringify([accountEmail ?? "", emailId]);
}
