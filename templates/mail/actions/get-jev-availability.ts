import { defineAction } from "@agent-native/core/action";
import { getDecisionsStatus } from "@agent-native/core/decisions";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

export default defineAction({
  description:
    "Check whether a decision provider is configured for this account. Mail priority sort and AI rules use any ready provider.",
  schema: z.object({}),
  outputSchema: z.object({ configured: z.boolean() }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async () => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) return { configured: false };
    const status = await getDecisionsStatus(ownerEmail);
    if (
      status.providers.some((provider) => provider.status === "unknown") &&
      !status.providers.some((provider) => provider.status === "ready")
    ) {
      throw new Error("Decision provider availability could not be checked.");
    }
    return {
      configured: status.providers.some(
        (provider) => provider.status === "ready",
      ),
    };
  },
});
