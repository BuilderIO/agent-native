import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { updateAutomationRule } from "../server/lib/automations.js";
import { automationActionSchema } from "../shared/automation-schema.js";

export default defineAction({
  description:
    "Update an inbox automation rule from the Settings UI. Only the supplied fields change.",
  schema: z.object({
    id: z.string().describe("Rule id"),
    name: z.string().optional().describe("Rule name"),
    condition: z
      .string()
      .optional()
      .describe("Natural-language match condition"),
    actions: z
      .array(automationActionSchema)
      .optional()
      .describe("Replacement action list"),
    enabled: z.boolean().optional().describe("Whether the rule is enabled"),
    domain: z.enum(["mail", "calendar"]).optional().describe("Rule domain"),
  }),
  http: { method: "PUT" },
  agentTool: false,
  run: async ({ id, ...patch }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");
    if (!id) throw new Error("id is required");
    return updateAutomationRule(ownerEmail, id, patch);
  },
});
