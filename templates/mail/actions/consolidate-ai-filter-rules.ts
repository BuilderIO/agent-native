import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { consolidateAutomationRules } from "../server/lib/automations.js";
import { automationActionSchema } from "../shared/automation-schema.js";

export default defineAction({
  description:
    "Update one active AI-filter prompt rule and delete its duplicates atomically.",
  schema: z.object({
    id: z.string().min(1).describe("Active rule to keep"),
    duplicateIds: z
      .array(z.string().min(1))
      .describe("Duplicate rule ids to delete"),
    expectedRules: z
      .array(
        z.object({
          id: z.string().min(1),
          name: z.string(),
          condition: z.string(),
          actions: z.array(automationActionSchema),
        }),
      )
      .min(1)
      .describe("Rule snapshots from the prompt draft"),
    name: z.string().describe("Name for the retained rule"),
    condition: z.string().min(1).describe("Combined prompt condition"),
    actions: z
      .array(automationActionSchema)
      .describe("Actions for the retained rule"),
  }),
  http: { method: "PUT" },
  agentTool: false,
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");
    const saved = await consolidateAutomationRules(ownerEmail, args);
    return { saved };
  },
});
