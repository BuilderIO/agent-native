import { parseArgs } from "@agent-native/core";
import { getAtlassianClient, agileUrl, jiraFetch } from "./helpers.js";

export default async function (args: string[]) {
  const { boardId } = parseArgs(args);

  if (!boardId) return "Error: --boardId is required";

  const client = await getAtlassianClient();

  const result = await jiraFetch(
    agileUrl(client.cloudId, `/board/${boardId}/sprint?maxResults=20`),
    client.accessToken,
  );

  const sprints = result.values || [];
  if (sprints.length === 0) return "No sprints found for this board.";

  return sprints
    .map(
      (s: any) =>
        `${s.id} | [${s.state.toUpperCase()}] ${s.name}${s.goal ? ` — ${s.goal}` : ""}`,
    )
    .join("\n");
}
