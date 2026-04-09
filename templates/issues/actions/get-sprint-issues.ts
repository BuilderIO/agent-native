import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getClient } from "../server/lib/jira-auth.js";
import {
  agileGetSprintIssues,
  AtlassianApiError,
} from "../server/lib/jira-api.js";

export default defineAction({
  description: "Get issues in a sprint",
  schema: z.object({
    sprintId: z.string().optional().describe("Sprint ID"),
    startAt: z.coerce
      .number()
      .optional()
      .describe("Start index for pagination"),
    maxResults: z.coerce
      .number()
      .optional()
      .describe("Max results (default 50)"),
  }),
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
          startAt: startAt ?? 0,
          maxResults: maxResults ?? 50,
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
