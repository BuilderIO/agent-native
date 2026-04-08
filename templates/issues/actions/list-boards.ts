import { defineAction } from "@agent-native/core";
import { getClient } from "../server/lib/jira-auth.js";
import { agileListBoards, AtlassianApiError } from "../server/lib/jira-api.js";

export default defineAction({
  description: "List Jira boards",
  parameters: {
    startAt: { type: "string", description: "Start index for pagination" },
    maxResults: { type: "string", description: "Max results (default 50)" },
    projectKeyOrId: { type: "string", description: "Filter by project" },
  },
  http: { method: "GET" },
  run: async (args) => {
    const { startAt, maxResults, projectKeyOrId } = args;

    const client = await getClient(process.env.AGENT_USER_EMAIL);
    if (!client) throw new Error("Jira not connected");

    try {
      return await agileListBoards(client.cloudId, client.accessToken, {
        startAt: startAt ? Number(startAt) : 0,
        maxResults: maxResults ? Number(maxResults) : 50,
        projectKeyOrId,
      });
    } catch (err) {
      if (
        err instanceof AtlassianApiError &&
        (err.status === 403 || err.status === 404)
      ) {
        return { values: [], total: 0 };
      }
      throw err;
    }
  },
});
