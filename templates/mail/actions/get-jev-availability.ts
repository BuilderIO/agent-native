import { defineAction } from "@agent-native/core/action";
import {
  getJevContextCredentials,
  getRequestUserEmail,
  isJevEnabled,
} from "@agent-native/core/server";
import { z } from "zod";

export default defineAction({
  description:
    "Check whether Jev is configured for this account through Builder or a direct Jev API key.",
  schema: z.object({}),
  outputSchema: z.object({ configured: z.boolean() }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async () => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) return { configured: false };
    const credentials = await getJevContextCredentials(ownerEmail);
    return { configured: await isJevEnabled(credentials) };
  },
});
