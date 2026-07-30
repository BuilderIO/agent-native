import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { deleteAutomationRule } from "../server/lib/automations.js";

export default defineAction({
  description: "Delete an inbox automation rule from the Settings UI.",
  schema: z.object({
    id: z.string().describe("Rule id"),
  }),
  http: { method: "DELETE" },
  agentTool: false,
  run: async ({ id }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");
    if (!id) throw new Error("id is required");
    await deleteAutomationRule(ownerEmail, id);
    return { success: true };
  },
});
