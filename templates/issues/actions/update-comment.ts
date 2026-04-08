import { defineAction } from "@agent-native/core";
import { getClient } from "../server/lib/jira-auth.js";
import { jiraUpdateComment } from "../server/lib/jira-api.js";
import { markdownToAdf } from "../server/lib/adf.js";

export default defineAction({
  description: "Update a comment on a Jira issue",
  parameters: {
    key: { type: "string", description: "Issue key" },
    commentId: { type: "string", description: "Comment ID" },
    body: { type: "string", description: "Updated comment text" },
  },
  run: async (args) => {
    const { key, commentId, body } = args;
    if (!key) throw new Error("key is required");
    if (!commentId) throw new Error("commentId is required");
    if (!body) throw new Error("body is required");

    const client = await getClient(process.env.AGENT_USER_EMAIL);
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
