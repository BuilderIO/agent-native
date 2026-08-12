import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { resolveAutomationModelSettings } from "../server/lib/automation-model.js";
import {
  allowsAutomationSends,
  type MailAutomationSettings,
} from "../server/lib/automation-settings.js";

export default defineAction({
  description:
    "Read the engine, model, and email-send permission used by inbox automations, falling back to the app's configured agent engine.",
  schema: z.object({}),
  http: { method: "GET" },
  agentTool: false,
  run: async () => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");

    const data = (await getUserSetting(
      ownerEmail,
      "automation-settings",
    )) as MailAutomationSettings | null;
    const modelSettings = await resolveAutomationModelSettings(
      ownerEmail,
      data,
    );
    return {
      ...modelSettings,
      allowAutomationSends: allowsAutomationSends(data),
    };
  },
});
