import { defineAction } from "@agent-native/core";
import { getClient } from "../server/lib/jira-auth.js";
import {
  jiraGetProject,
  jiraGetProjectStatuses,
} from "../server/lib/jira-api.js";

export default defineAction({
  description: "Get a Jira project with its statuses",
  parameters: {
    projectKey: { type: "string", description: "Project key" },
  },
  http: { method: "GET" },
  run: async (args) => {
    const { projectKey } = args;
    if (!projectKey) throw new Error("projectKey is required");

    const client = await getClient(process.env.AGENT_USER_EMAIL);
    if (!client) throw new Error("Jira not connected");

    const [project, statuses] = await Promise.all([
      jiraGetProject(client.cloudId, client.accessToken, projectKey),
      jiraGetProjectStatuses(client.cloudId, client.accessToken, projectKey),
    ]);

    return { ...project, statuses };
  },
});
