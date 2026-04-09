import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getClient } from "../server/lib/jira-auth.js";
import { jiraGetTransitions } from "../server/lib/jira-api.js";

export default defineAction({
  description: "Get available transitions for a Jira issue",
  schema: z.object({
    key: z.string().optional().describe("Issue key (e.g. PROJ-123)"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const { key } = args;
    if (!key) throw new Error("key is required");

    const client = await getClient(process.env.AGENT_USER_EMAIL);
    if (!client) throw new Error("Jira not connected");

    return await jiraGetTransitions(client.cloudId, client.accessToken, key);
  },
});
