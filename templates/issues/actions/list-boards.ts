import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getClient } from "../server/lib/jira-auth.js";
import { agileListBoards, AtlassianApiError } from "../server/lib/jira-api.js";

export default defineAction({
  description: "List Jira boards",
  schema: z.object({
    startAt: z.coerce
      .number()
      .optional()
      .describe("Start index for pagination"),
    maxResults: z.coerce
      .number()
      .optional()
      .describe("Max results (default 50)"),
    projectKeyOrId: z.string().optional().describe("Filter by project"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const { startAt, maxResults, projectKeyOrId } = args;

    const client = await getClient(process.env.AGENT_USER_EMAIL);
    if (!client) throw new Error("Jira not connected");

    try {
      return await agileListBoards(client.cloudId, client.accessToken, {
        startAt: startAt ?? 0,
        maxResults: maxResults ?? 50,
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
