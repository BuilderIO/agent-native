import { z } from "zod";

import type { AutomationAction } from "./types.js";

export const AI_FILTER_LABEL = "agent-native-filtered";
export const AI_FILTER_RULE_NAME = "AI filter learned examples";
export const AI_FILTER_MIN_LEARNED_EXAMPLES = 3;
export const AI_FILTER_DEFAULT_THRESHOLD = 0.92;
export const AI_FILTER_DEFAULT_SUGGESTION_THRESHOLD = 0.72;

export const AI_FILTER_ACTIONS: AutomationAction[] = [
  { type: "label", labelName: AI_FILTER_LABEL },
  { type: "archive" },
];

export const aiFilterTargetSchema = z.object({
  id: z.string().min(1).max(256),
  threadId: z.string().max(256).optional(),
  accountEmail: z.string().email().optional(),
  sender: z.string().max(320).optional(),
  subject: z.string().max(500).optional(),
});

export type AiFilterTarget = z.infer<typeof aiFilterTargetSchema>;

const aiFilterFeedbackSchema = z.object({
  id: z.string().min(1).max(32),
  disposition: z.enum(["spam", "not_spam"]),
  sender: z.string().max(320),
  subject: z.string().max(500),
  comment: z.string().max(500).optional(),
  createdAt: z.number().int().nonnegative(),
});

const aiFilterDecisionSchema = z.object({
  id: z.string().min(1).max(32),
  messageId: z.string().min(1).max(256),
  threadId: z.string().max(256).optional(),
  accountEmail: z.string().email().optional(),
  sender: z.string().max(320),
  subject: z.string().max(500),
  disposition: z.enum(["suggested", "filtered", "kept"]),
  source: z.enum(["manual", "automatic"]),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().max(500).optional(),
  createdAt: z.number().int().nonnegative(),
});

export type AiFilterFeedback = z.infer<typeof aiFilterFeedbackSchema>;
export type AiFilterDecision = z.infer<typeof aiFilterDecisionSchema>;

export const aiFilterStateSchema = z.object({
  enabled: z.boolean(),
  autoFilter: z.boolean(),
  autoFilterThreshold: z.number().min(0.5).max(1),
  suggestionThreshold: z.number().min(0.5).max(1),
  labelName: z.literal(AI_FILTER_LABEL),
  feedback: z.array(aiFilterFeedbackSchema).max(100),
  decisions: z.array(aiFilterDecisionSchema).max(200),
});

export type AiFilterState = z.infer<typeof aiFilterStateSchema>;

export function createDefaultAiFilterState(): AiFilterState {
  return {
    enabled: true,
    autoFilter: true,
    autoFilterThreshold: AI_FILTER_DEFAULT_THRESHOLD,
    suggestionThreshold: AI_FILTER_DEFAULT_SUGGESTION_THRESHOLD,
    labelName: AI_FILTER_LABEL,
    feedback: [],
    decisions: [],
  };
}
