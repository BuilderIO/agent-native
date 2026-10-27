import { defineAction, fail } from "@agent-native/core/action";
import {
  getDecisionsStatus,
  JEV_DECISIONS_MODEL,
  OPENAI_DECISIONS_MODEL,
} from "@agent-native/core/decisions";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

export default defineAction({
  description:
    "Check whether a decision provider is configured for this account. Mail priority sort and AI rules use any ready provider.",
  schema: z.object({}),
  outputSchema: z.object({
    configured: z.boolean(),
    providerIdentity: z.string(),
  }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async () => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      return { configured: false, providerIdentity: "unavailable" };
    }
    const status = await getDecisionsStatus(ownerEmail);
    if (
      status.providers.some((provider) => provider.status === "unknown") &&
      !status.providers.some((provider) => provider.status === "ready")
    ) {
      fail("Decision provider availability could not be checked.", {
        errorCode: "jev_availability_failed",
        statusCode: 503,
      });
    }
    return {
      configured: status.providers.some(
        (provider) => provider.status === "ready",
      ),
      providerIdentity: JSON.stringify({
        providerOrder: status.providerOrder,
        providers: status.providers
          .map(({ provider, status: providerStatus }) => ({
            provider,
            status: providerStatus,
            model:
              provider === "jev" ? JEV_DECISIONS_MODEL : OPENAI_DECISIONS_MODEL,
          }))
          .sort((a, b) => a.provider.localeCompare(b.provider)),
      }),
    };
  },
});
