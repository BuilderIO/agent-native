import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { writeBrainSettings } from "../server/lib/brain.js";
import { publishTierSchema, stringArrayCliSchema } from "./_schemas.js";

function hasPrivacyWeakeningInstruction(value: string) {
  const matches = value.matchAll(
    /\b(?:allow|permit|release|retain|store|index|ignore|override|relax|weaken|lower|disable)\b/gi,
  );
  for (const match of matches) {
    const index = match.index ?? 0;
    const prefix = value.slice(Math.max(0, index - 32), index);
    if (/\b(?:do not|don't|never|must not|cannot|can't)\s*$/i.test(prefix)) {
      continue;
    }
    return true;
  }
  return false;
}

const privacyInstructionsSchema = z
  .string()
  .max(4_000)
  .refine((value) => !hasPrivacyWeakeningInstruction(value), {
    message:
      "Privacy instructions may only add stricter exclusions; they cannot permit, retain, store, index, or release content.",
  });

export default defineAction({
  description: "Update Brain template settings.",
  schema: z.object({
    companyName: z.string().max(120).optional(),
    assistantName: z.string().max(80).optional(),
    assistantTone: z
      .enum(["direct", "friendly", "formal", "technical"])
      .optional(),
    sourcePolicy: z.enum(["strict", "balanced", "exploratory"]).optional(),
    requireApprovalForCompanyKnowledge: z.coerce.boolean().optional(),
    autoRedactEmails: z.coerce.boolean().optional(),
    defaultPublishTier: publishTierSchema.optional(),
    distillationInstructions: z.string().max(8000).optional(),
    captureSanitizationEnabled: z.coerce.boolean().optional(),
    captureSanitizationModel: z.string().max(160).optional(),
    captureSanitizationInstructions: z.string().max(4000).optional(),
    privacyClassifierModel: z.string().max(160).optional(),
    privacyClassifierEngine: z.string().max(160).optional(),
    sensitivityCustomInstructions: privacyInstructionsSchema.optional(),
    publicChannelExclusionPatterns: stringArrayCliSchema({ max: 100 })
      .transform((patterns) => patterns.map((pattern) => pattern.trim()))
      .optional(),
    quarantineRetentionHours: z.coerce
      .number()
      .int()
      .min(1)
      .max(720)
      .optional(),
    connectorPollMinutes: z.coerce.number().int().min(5).max(1440).optional(),
    requireCitations: z.coerce.boolean().optional(),
    autoArchiveResolved: z.coerce.boolean().optional(),
    notifyOnSourceErrors: z.coerce.boolean().optional(),
  }),
  run: async (args) => ({ settings: await writeBrainSettings(args) }),
});
