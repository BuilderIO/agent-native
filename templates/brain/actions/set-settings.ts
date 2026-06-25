import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { writeBrainSettings } from "../server/lib/brain.js";
import { publishTierSchema } from "./_schemas.js";

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
    connectorPollMinutes: z.coerce.number().int().min(5).max(1440).optional(),
    requireCitations: z.coerce.boolean().optional(),
    autoArchiveResolved: z.coerce.boolean().optional(),
    notifyOnSourceErrors: z.coerce.boolean().optional(),
  }),
  run: async (args) => ({ settings: await writeBrainSettings(args) }),
});
