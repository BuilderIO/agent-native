import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { createAutomationRule } from "../server/lib/automations.js";
import { automationActionSchema } from "../shared/automation-schema.js";

export default defineAction({
  description: "Create an inbox automation rule from the Settings UI.",
  schema: z.object({
    name: z.string().describe("Rule name"),
    condition: z.string().describe("Natural-language match condition"),
    actions: z
      .array(automationActionSchema)
      .describe("Actions applied when the condition matches"),
    domain: z.enum(["mail", "calendar"]).optional().describe("Rule domain"),
    enabled: z.boolean().optional().describe("Whether the rule starts enabled"),
  }),
  agentTool: false,
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");
    if (!args.name || !args.condition || !args.actions) {
      throw new Error("name, condition, and actions are required");
    }
    return createAutomationRule(ownerEmail, args);
  },
});
