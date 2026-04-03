import { parseArgs } from "@agent-native/core";
import { getAtlassianClient, jiraUrl, jiraFetch } from "./helpers.js";

export default async function (args: string[]) {
  const { jql, q, compact, maxResults } = parseArgs(args);

  if (!jql && !q) return "Error: --jql or --q is required";

  const client = await getAtlassianClient();

  const query = jql ? (jql as string) : `text ~ "${q}" ORDER BY updated DESC`;

  const result = await jiraFetch(
    jiraUrl(client.cloudId, "/search/jql"),
    client.accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        jql: query,
        maxResults: Number(maxResults) || 25,
        fields: [
          "summary",
          "status",
          "priority",
          "assignee",
          "issuetype",
          "project",
        ],
      }),
    },
  );

  const issues = result.issues || [];
  if (issues.length === 0) return "No issues found.";

  if (compact) {
    return issues
      .map((i: any) => `${i.key} [${i.fields.status.name}] ${i.fields.summary}`)
      .join("\n");
  }

  return issues
    .map(
      (i: any) =>
        `${i.key} | ${i.fields.issuetype?.name} | ${i.fields.status.name} | ${i.fields.priority?.name || "-"} | ${i.fields.assignee?.displayName || "Unassigned"} | ${i.fields.summary}`,
    )
    .join("\n");
}
