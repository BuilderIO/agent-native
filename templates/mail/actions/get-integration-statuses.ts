import { defineAction } from "@agent-native/core/action";
import { getCredentialContext } from "@agent-native/core/server";
import { z } from "zod";

import { readIntegrationStatuses } from "../server/lib/integration-keys.js";

export default defineAction({
  description:
    "Read which optional Mail contact-sidebar integrations are configured without returning credential values.",
  schema: z.object({}),
  outputSchema: z.object({
    apollo: z.boolean(),
    hubspot: z.boolean(),
    gong: z.boolean(),
    pylon: z.boolean(),
  }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async () => {
    const ctx = getCredentialContext();
    if (!ctx) throw new Error("no authenticated user");
    return readIntegrationStatuses(ctx);
  },
});
