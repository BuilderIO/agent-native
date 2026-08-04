import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { resolveAutomationModelSettings } from "../server/lib/automation-model.js";

export default defineAction({
  description:
    "Read the engine and model used to evaluate inbox automation rules, falling back to the app's configured agent engine.",
  schema: z.object({}),
  http: { method: "GET" },
  agentTool: false,
  run: async () => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");

    const data = (await getUserSetting(ownerEmail, "automation-settings")) as {
      engine?: string;
      model?: string;
    } | null;
    return resolveAutomationModelSettings(ownerEmail, data);
  },
});
