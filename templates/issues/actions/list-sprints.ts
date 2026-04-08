import { defineAction } from "@agent-native/core";
import { getClient } from "../server/lib/jira-auth.js";
import { agileListSprints } from "../server/lib/jira-api.js";

export default defineAction({
  description: "List sprints for a board",
  parameters: {
    boardId: { type: "string", description: "Board ID" },
    state: { type: "string", description: "Sprint state filter" },
  },
  http: { method: "GET" },
  run: async (args) => {
    const { boardId, state } = args;

    if (!boardId) throw new Error("boardId is required");

    const client = await getClient(process.env.AGENT_USER_EMAIL);
    if (!client) throw new Error("Jira not connected");

    return await agileListSprints(client.cloudId, client.accessToken, boardId, {
      state,
      maxResults: 50,
    });
  },
});
