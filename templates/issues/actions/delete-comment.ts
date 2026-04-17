import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";
import { getClient } from "../server/lib/jira-auth.js";
import { jiraDeleteComment } from "../server/lib/jira-api.js";

export default defineAction({
  description: "Delete a comment from a Jira issue",
  schema: z.object({
    key: z.string().optional().describe("Issue key"),
    commentId: z.string().optional().describe("Comment ID"),
  }),
  run: async (args) => {
    const { key, commentId } = args;
    if (!key) throw new Error("key is required");
    if (!commentId) throw new Error("commentId is required");

    const client = await getClient(getRequestUserEmail());
    if (!client) throw new Error("Jira not connected");

    await jiraDeleteComment(client.cloudId, client.accessToken, key, commentId);
    return { success: true };
  },
});
