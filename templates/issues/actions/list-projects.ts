import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";
import { getClient } from "../server/lib/jira-auth.js";
import { jiraListProjects } from "../server/lib/jira-api.js";

export default defineAction({
  description: "List accessible Jira projects",
  schema: z.object({
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
    const { startAt, maxResults } = args;

    const client = await getClient(getRequestUserEmail());
    if (!client) throw new Error("Jira not connected");

    return await jiraListProjects(client.cloudId, client.accessToken, {
      startAt: startAt ?? 0,
      maxResults: maxResults ?? 50,
    });
  },
});
