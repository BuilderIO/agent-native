import { parseArgs } from "@agent-native/core";
import { getAtlassianClient, jiraUrl, jiraFetch } from "./helpers.js";

export default async function (args: string[]) {
  const { key, summary, description, priority, assignee, labels } =
    parseArgs(args);

  if (!key) return "Error: --key is required (e.g. --key=PROJ-123)";

  const client = await getAtlassianClient();

  const fields: Record<string, unknown> = {};
  if (summary) fields.summary = summary as string;
  if (priority) fields.priority = { name: priority as string };
  if (assignee) fields.assignee = { accountId: assignee as string };
  if (labels)
    fields.labels = (labels as string).split(",").map((l) => l.trim());
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

  if (Object.keys(fields).length === 0) {
    return "Error: provide at least one field to update (--summary, --description, --priority, --assignee, --labels)";
  }

  await jiraFetch(
    jiraUrl(client.cloudId, `/issue/${key}`),
    client.accessToken,
    {
      method: "PUT",
      body: JSON.stringify({ fields }),
    },
  );

  return `Updated ${key}`;
}
