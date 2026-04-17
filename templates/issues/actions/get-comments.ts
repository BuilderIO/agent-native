import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";
import { getClient } from "../server/lib/jira-auth.js";
import { jiraGetComments } from "../server/lib/jira-api.js";

export default defineAction({
  description: "Get comments for a Jira issue",
  schema: z.object({
    key: z.string().optional().describe("Issue key (e.g. PROJ-123)"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const { key } = args;
    if (!key) throw new Error("key is required");

    const client = await getClient(getRequestUserEmail());
    if (!client) throw new Error("Jira not connected");

    return await jiraGetComments(client.cloudId, client.accessToken, key, {
      orderBy: "-created",
      maxResults: 100,
    });
  },
});
