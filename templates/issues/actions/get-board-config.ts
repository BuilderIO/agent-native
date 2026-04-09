import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getClient } from "../server/lib/jira-auth.js";
import { agileGetBoardConfig } from "../server/lib/jira-api.js";

export default defineAction({
  description: "Get board configuration (columns, statuses)",
  schema: z.object({
    boardId: z.string().optional().describe("Board ID"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const { boardId } = args;
    if (!boardId) throw new Error("boardId is required");

    const client = await getClient(process.env.AGENT_USER_EMAIL);
    if (!client) throw new Error("Jira not connected");

    return await agileGetBoardConfig(
      client.cloudId,
      client.accessToken,
      boardId,
    );
  },
});
