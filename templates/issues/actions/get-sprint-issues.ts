import { defineAction } from "@agent-native/core";
import { getClient } from "../server/lib/jira-auth.js";
import {
  agileGetSprintIssues,
  AtlassianApiError,
} from "../server/lib/jira-api.js";

export default defineAction({
  description: "Get issues in a sprint",
  parameters: {
    sprintId: { type: "string", description: "Sprint ID" },
    startAt: { type: "string", description: "Start index for pagination" },
    maxResults: { type: "string", description: "Max results (default 50)" },
  },
  http: { method: "GET" },
  run: async (args) => {
    const { sprintId, startAt, maxResults } = args;
    if (!sprintId) throw new Error("sprintId is required");

    const client = await getClient(process.env.AGENT_USER_EMAIL);
    if (!client) throw new Error("Jira not connected");

    try {
      return await agileGetSprintIssues(
        client.cloudId,
        client.accessToken,
        sprintId,
        {
          startAt: startAt ? Number(startAt) : 0,
          maxResults: maxResults ? Number(maxResults) : 50,
        },
      );
    } catch (err) {
      if (
        err instanceof AtlassianApiError &&
        (err.status === 403 || err.status === 404)
      ) {
        return { startAt: 0, maxResults: 0, total: 0, issues: [] };
      }
      throw err;
    }
  },
});
