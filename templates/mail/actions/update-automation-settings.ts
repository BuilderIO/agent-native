import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import type { MailAutomationSettings } from "../server/lib/automation-settings.js";

export default defineAction({
  description:
    "Set the engine and model used to evaluate inbox automation rules, and choose whether automations may send email without per-message approval.",
  schema: z.object({
    engine: z.string().optional().describe("Agent engine id"),
    model: z.string().optional().describe("Model id for that engine"),
    allowAutomationSends: z
      .boolean()
      .optional()
      .describe("Allow automation-triggered emails to send without approval"),
  }),
  http: { method: "PUT" },
  agentTool: false,
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");

    const existing =
      ((await getUserSetting(
        ownerEmail,
        "automation-settings",
      )) as MailAutomationSettings | null) || {};
    const updated = {
      ...existing,
      ...(args.engine ? { engine: args.engine } : {}),
      ...(args.model ? { model: args.model } : {}),
      ...(args.allowAutomationSends !== undefined
        ? { allowAutomationSends: args.allowAutomationSends }
        : {}),
    };
    await putUserSetting(ownerEmail, "automation-settings", updated);

    return {
      success: true,
      engine: updated.engine,
      model: updated.model,
      allowAutomationSends: updated.allowAutomationSends === true,
    };
  },
});
