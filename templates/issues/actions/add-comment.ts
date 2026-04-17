import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";
import { getClient } from "../server/lib/jira-auth.js";
import { jiraAddComment } from "../server/lib/jira-api.js";
import { markdownToAdf } from "../server/lib/adf.js";

export default defineAction({
  description: "Add a comment to a Jira issue",
  schema: z.object({
    key: z.string().optional().describe("Issue key"),
    body: z.string().optional().describe("Comment text"),
  }),
  run: async (args) => {
    const { key, body } = args;

    if (!key) throw new Error("key is required");
    if (!body) throw new Error("body is required");

    const client = await getClient(getRequestUserEmail());
    if (!client) throw new Error("Jira not connected");

    const adfBody = markdownToAdf(body);
    return await jiraAddComment(
      client.cloudId,
      client.accessToken,
      key,
      adfBody,
    );
  },
});
