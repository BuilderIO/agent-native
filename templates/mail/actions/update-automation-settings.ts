import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

export default defineAction({
  description:
    "Set the engine and model used to evaluate inbox automation rules.",
  schema: z.object({
    engine: z.string().optional().describe("Agent engine id"),
    model: z.string().optional().describe("Model id for that engine"),
  }),
  http: { method: "PUT" },
  agentTool: false,
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");

    const existing =
      ((await getUserSetting(ownerEmail, "automation-settings")) as {
        engine?: string;
        model?: string;
      } | null) || {};
    const updated = {
      ...existing,
      ...(args.engine ? { engine: args.engine } : {}),
      ...(args.model ? { model: args.model } : {}),
    };
    await putUserSetting(ownerEmail, "automation-settings", updated);

    return { success: true, engine: updated.engine, model: updated.model };
  },
});
