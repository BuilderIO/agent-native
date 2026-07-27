import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { deleteUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

export default defineAction({
  agentTool: false,
  description:
    "Delete a per-user UI preference record from the settings store.",
  schema: z.object({
    key: z.string().min(1).describe("Preference key"),
  }),
  http: { method: "DELETE" },
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) {
      throw Object.assign(new Error("Not authenticated"), { statusCode: 401 });
    }
    await deleteUserSetting(email, args.key);
    return { success: true };
  },
});
