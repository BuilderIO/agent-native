import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";
import { getClient } from "../server/lib/jira-auth.js";
import { jiraUpdateComment } from "../server/lib/jira-api.js";
import { markdownToAdf } from "../server/lib/adf.js";

export default defineAction({
  description: "Update a comment on a Jira issue",
  schema: z.object({
    key: z.string().optional().describe("Issue key"),
    commentId: z.string().optional().describe("Comment ID"),
    body: z.string().optional().describe("Updated comment text"),
  }),
  run: async (args) => {
    const { key, commentId, body } = args;
    if (!key) throw new Error("key is required");
    if (!commentId) throw new Error("commentId is required");
    if (!body) throw new Error("body is required");

    const client = await getClient(getRequestUserEmail());
    if (!client) throw new Error("Jira not connected");

    const adfBody = markdownToAdf(body);
    return await jiraUpdateComment(
      client.cloudId,
      client.accessToken,
      key,
      commentId,
      adfBody,
    );
  },
});
