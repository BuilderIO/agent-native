import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";
import { getClient } from "../server/lib/jira-auth.js";
import {
  jiraGetProject,
  jiraGetProjectStatuses,
} from "../server/lib/jira-api.js";

export default defineAction({
  description: "Get a Jira project with its statuses",
  schema: z.object({
    projectKey: z.string().optional().describe("Project key"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const { projectKey } = args;
    if (!projectKey) throw new Error("projectKey is required");

    const client = await getClient(getRequestUserEmail());
    if (!client) throw new Error("Jira not connected");

    const [project, statuses] = await Promise.all([
      jiraGetProject(client.cloudId, client.accessToken, projectKey),
      jiraGetProjectStatuses(client.cloudId, client.accessToken, projectKey),
    ]);

    return { ...project, statuses };
  },
});
