import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { putUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

export default defineAction({
  agentTool: false,
  description: "Write a per-user UI preference record to the settings store.",
  schema: z.object({
    key: z.string().min(1).describe("Preference key"),
    value: z
      .record(z.string(), z.unknown())
      .describe("Preference record to store under the key"),
  }),
  http: { method: "PUT" },
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) {
      throw Object.assign(new Error("Not authenticated"), { statusCode: 401 });
    }
    await putUserSetting(email, args.key, args.value);
    return { success: true };
  },
});
