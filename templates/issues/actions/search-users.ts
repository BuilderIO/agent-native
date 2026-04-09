import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getClient } from "../server/lib/jira-auth.js";
import { jiraSearchUsers } from "../server/lib/jira-api.js";

export default defineAction({
  description: "Search Jira users",
  schema: z.object({
    query: z.string().optional().describe("Search query"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const { query } = args;

    const client = await getClient(process.env.AGENT_USER_EMAIL);
    if (!client) throw new Error("Jira not connected");

    return await jiraSearchUsers(
      client.cloudId,
      client.accessToken,
      query || "",
    );
  },
});
