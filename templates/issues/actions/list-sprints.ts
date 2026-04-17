import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";
import { getClient } from "../server/lib/jira-auth.js";
import { agileListSprints } from "../server/lib/jira-api.js";

export default defineAction({
  description: "List sprints for a board",
  schema: z.object({
    boardId: z.string().optional().describe("Board ID"),
    state: z.string().optional().describe("Sprint state filter"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const { boardId, state } = args;

    if (!boardId) throw new Error("boardId is required");

    const client = await getClient(getRequestUserEmail());
    if (!client) throw new Error("Jira not connected");

    return await agileListSprints(client.cloudId, client.accessToken, boardId, {
      state,
      maxResults: 50,
    });
  },
});
