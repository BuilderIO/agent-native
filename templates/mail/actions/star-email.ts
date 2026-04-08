import { defineAction } from "@agent-native/core";
import { getAccessTokens } from "./helpers.js";
import { gmailModifyMessage } from "../server/lib/google-api.js";

export default defineAction({
  description: "Star or unstar one or more emails.",
  parameters: {
    id: { type: "string", description: "Email ID(s), comma-separated" },
    unstar: {
      type: "string",
      description: "Set to 'true' to remove star",
      enum: ["true", "false"],
    },
  },
  run: async (args) => {
    const ids = args.id
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids || ids.length === 0) return "Error: --id is required";
    const unstar = args.unstar === "true";

    const accounts = await getAccessTokens();
    if (accounts.length === 0) return "Error: No Google account connected.";

    const results: { id: string; success: boolean; error?: string }[] = [];
    for (const id of ids) {
      let success = false;
      const errors: string[] = [];
      for (const { accessToken } of accounts) {
        try {
          await gmailModifyMessage(
            accessToken,
            id,
            unstar ? undefined : ["STARRED"],
            unstar ? ["STARRED"] : undefined,
          );
          success = true;
          break;
        } catch (err: any) {
          errors.push(err?.message || "Gmail API error");
        }
      }
      results.push(
        success
          ? { id, success: true }
          : { id, success: false, error: errors.join("; ") },
      );
    }

    const action = unstar ? "Unstarred" : "Starred";
    const succeeded = results.filter((r) => r.success).length;
    return `${action} ${succeeded}/${ids.length} email(s)`;
  },
});
