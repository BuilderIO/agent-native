import { defineAction, fail } from "@agent-native/core/action";
import { getCredentialContext } from "@agent-native/core/server";
import { z } from "zod";

import {
  deleteIntegrationKey,
  INTEGRATION_PROVIDERS,
} from "../server/lib/integration-keys.js";

export default defineAction({
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  description:
    "Remove the contact-sidebar integration API key this person saved in the credential store.",
  schema: z.object({ provider: z.enum(INTEGRATION_PROVIDERS) }).strict(),
  outputSchema: z.object({ deleted: z.literal(true) }),
  http: { method: "POST" },
  run: async ({ provider }) => {
    const ctx = getCredentialContext();
    if (!ctx) {
      fail("no authenticated user", {
        errorCode: "authentication_required",
        statusCode: 401,
      });
    }
    await deleteIntegrationKey(provider, ctx);
    return { deleted: true as const };
  },
});
