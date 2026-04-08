import { defineAction } from "@agent-native/core";
import { getClient } from "../server/lib/jira-auth.js";
import { jiraDeleteComment } from "../server/lib/jira-api.js";

export default defineAction({
  description: "Delete a comment from a Jira issue",
  parameters: {
    key: { type: "string", description: "Issue key" },
    commentId: { type: "string", description: "Comment ID" },
  },
  run: async (args) => {
    const { key, commentId } = args;
    if (!key) throw new Error("key is required");
    if (!commentId) throw new Error("commentId is required");

    const client = await getClient(process.env.AGENT_USER_EMAIL);
    if (!client) throw new Error("Jira not connected");

    await jiraDeleteComment(client.cloudId, client.accessToken, key, commentId);
    return { success: true };
  },
});
