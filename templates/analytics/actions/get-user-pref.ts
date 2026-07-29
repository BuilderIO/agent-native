import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

export default defineAction({
  agentTool: false,
  description: "Read a per-user UI preference record from the settings store.",
  schema: z.object({
    key: z.string().min(1).describe("Preference key"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) {
      throw Object.assign(new Error("Not authenticated"), { statusCode: 401 });
    }
    const data = await getUserSetting(email, args.key);
    return data ?? {};
  },
});
