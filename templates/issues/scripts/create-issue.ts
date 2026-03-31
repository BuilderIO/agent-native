import { parseArgs } from "@agent-native/core";
import { getAtlassianClient, jiraUrl, jiraFetch } from "./helpers.js";

export default async function (args: string[]) {
  const { project, type, summary, description, priority, assignee } =
    parseArgs(args);

  if (!project) return "Error: --project is required (project key)";
  if (!summary) return "Error: --summary is required";

  const client = await getAtlassianClient();

  const fields: Record<string, unknown> = {
    project: { key: project as string },
    summary: summary as string,
    issuetype: { name: (type as string) || "Task" },
  };

  if (priority) fields.priority = { name: priority as string };
  if (assignee) fields.assignee = { accountId: assignee as string };
  if (description) {
    fields.description = {
      version: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: description as string }],
        },
      ],
    };
  }

  const result = await jiraFetch(
    jiraUrl(client.cloudId, "/issue"),
    client.accessToken,
    {
      method: "POST",
      body: JSON.stringify({ fields }),
    },
  );

  return `Created ${result.key}: ${summary}`;
}
