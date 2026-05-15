import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { writeBrainSettings } from "../server/lib/brain.js";
import { publishTierSchema } from "./_schemas.js";

export default defineAction({
  description: "Update Brain template settings.",
  schema: z.object({
    requireApprovalForCompanyKnowledge: z.coerce.boolean().optional(),
    autoRedactEmails: z.coerce.boolean().optional(),
    defaultPublishTier: publishTierSchema.optional(),
    distillationInstructions: z.string().optional(),
    connectorPollMinutes: z.coerce.number().int().min(5).max(1440).optional(),
  }),
  run: async (args) => ({ settings: await writeBrainSettings(args) }),
});
