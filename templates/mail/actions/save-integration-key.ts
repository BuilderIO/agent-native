import { defineAction, fail } from "@agent-native/core/action";
import { getCredentialContext } from "@agent-native/core/server";
import { z } from "zod";

import {
  INTEGRATION_PROVIDERS,
  saveIntegrationKey,
} from "../server/lib/integration-keys.js";

export default defineAction({
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  persistInChatHistory: false,
  audit: { recordInputs: false },
  description:
    "Save a contact-sidebar integration API key to the encrypted credential store. The key is never returned.",
  schema: z
    .object({
      provider: z.enum(INTEGRATION_PROVIDERS),
      apiKey: z.string().trim().min(1).max(4096),
    })
    .strict(),
  outputSchema: z.object({ saved: z.literal(true) }),
  http: { method: "POST" },
  run: async ({ provider, apiKey }) => {
    const ctx = getCredentialContext();
    if (!ctx) {
      fail("no authenticated user", {
        errorCode: "authentication_required",
        statusCode: 401,
      });
    }
    await saveIntegrationKey(provider, apiKey, ctx);
    return { saved: true as const };
  },
});
