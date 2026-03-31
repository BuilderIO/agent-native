import { parseArgs } from "@agent-native/core";
import { getAtlassianClient, jiraUrl, jiraFetch } from "./helpers.js";

export default async function (args: string[]) {
  const { view, projectKey, jql, q, compact, maxResults } = parseArgs(args);
  const client = await getAtlassianClient();

  let query: string;
  const v = (view as string) || "my-issues";

  if (jql) {
    query = jql as string;
  } else {
    switch (v) {
      case "my-issues":
        query =
          "assignee = currentUser() AND resolution = Unresolved ORDER BY status ASC, updated DESC";
        break;
      case "project":
        if (!projectKey) return "Error: --projectKey required for project view";
        query = `project = "${projectKey}" ORDER BY updated DESC`;
        break;
      case "recent":
        query = "assignee = currentUser() ORDER BY updated DESC";
        break;
      default:
        query =
          "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC";
    }

    if (q) {
      const base = query.split("ORDER BY")[0].trim();
      const order = query.split("ORDER BY")[1]?.trim() || "updated DESC";
      query = `text ~ "${q}" AND (${base}) ORDER BY ${order}`;
    }
  }

  const params = new URLSearchParams({
    jql: query,
    maxResults: String(maxResults || 25),
    fields: "summary,status,priority,assignee,issuetype,project,labels,updated",
  });

  const result = await jiraFetch(
    jiraUrl(client.cloudId, `/search?${params}`),
    client.accessToken,
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
        `${i.key} | ${i.fields.issuetype?.name || "Task"} | ${i.fields.status.name} | ${i.fields.priority?.name || "-"} | ${i.fields.assignee?.displayName || "Unassigned"} | ${i.fields.summary}`,
    )
    .join("\n");
}
