import { parseArgs } from "@agent-native/core";
import { getAtlassianClient, jiraUrl, jiraFetch } from "./helpers.js";

export default async function (args: string[]) {
  const { compact } = parseArgs(args);
  const client = await getAtlassianClient();

  const result = await jiraFetch(
    jiraUrl(client.cloudId, "/project/search?maxResults=50"),
    client.accessToken,
  );

  const projects = result.values || [];
  if (projects.length === 0) return "No projects found.";

  if (compact) {
    return projects.map((p: any) => `${p.key} — ${p.name}`).join("\n");
  }

  return projects
    .map(
      (p: any) =>
        `${p.key} | ${p.name} | ${p.projectTypeKey || "-"} | Lead: ${p.lead?.displayName || "-"}`,
    )
    .join("\n");
}
