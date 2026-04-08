import { defineAction } from "@agent-native/core";
import { getClient } from "../server/lib/jira-auth.js";
import { jiraAddComment } from "../server/lib/jira-api.js";
import { markdownToAdf } from "../server/lib/adf.js";

export default defineAction({
  description: "Add a comment to a Jira issue",
  parameters: {
    key: { type: "string", description: "Issue key" },
    body: { type: "string", description: "Comment text" },
  },
  run: async (args) => {
    const { key, body } = args;

    if (!key) throw new Error("key is required");
    if (!body) throw new Error("body is required");

    const client = await getClient(process.env.AGENT_USER_EMAIL);
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
