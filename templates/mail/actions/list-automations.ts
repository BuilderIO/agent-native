import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { listAutomationRules } from "../server/lib/automations.js";

export default defineAction({
  description:
    "List the user's inbox automation rules as structured rows for the Settings UI.",
  schema: z.object({}),
  http: { method: "GET" },
  agentTool: false,
  run: async () => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");
    return listAutomationRules(ownerEmail);
  },
});
