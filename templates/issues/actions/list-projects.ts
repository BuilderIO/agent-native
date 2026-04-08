import { defineAction } from "@agent-native/core";
import { getClient } from "../server/lib/jira-auth.js";
import { jiraListProjects } from "../server/lib/jira-api.js";

export default defineAction({
  description: "List accessible Jira projects",
  parameters: {
    startAt: { type: "string", description: "Start index for pagination" },
    maxResults: { type: "string", description: "Max results (default 50)" },
  },
  http: { method: "GET" },
  run: async (args) => {
    const { startAt, maxResults } = args;

    const client = await getClient(process.env.AGENT_USER_EMAIL);
    if (!client) throw new Error("Jira not connected");

    return await jiraListProjects(client.cloudId, client.accessToken, {
      startAt: startAt ? Number(startAt) : 0,
      maxResults: maxResults ? Number(maxResults) : 50,
    });
  },
});
