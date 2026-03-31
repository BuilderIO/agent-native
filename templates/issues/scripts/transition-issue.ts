import { parseArgs } from "@agent-native/core";
import { getAtlassianClient, jiraUrl, jiraFetch } from "./helpers.js";

export default async function (args: string[]) {
  const { key, status } = parseArgs(args);

  if (!key) return "Error: --key is required";
  if (!status) return "Error: --status is required (target status name)";

  const client = await getAtlassianClient();

  // Get available transitions
  const transitionsData = await jiraFetch(
    jiraUrl(client.cloudId, `/issue/${key}/transitions`),
    client.accessToken,
  );

  const transitions = transitionsData.transitions || [];
  const target = (status as string).toLowerCase();
  const transition = transitions.find(
    (t: any) =>
      t.name.toLowerCase() === target || t.to?.name?.toLowerCase() === target,
  );

  if (!transition) {
    const available = transitions.map((t: any) => t.name).join(", ");
    return `Error: No transition found for "${status}". Available: ${available}`;
  }

  await jiraFetch(
    jiraUrl(client.cloudId, `/issue/${key}/transitions`),
    client.accessToken,
    {
      method: "POST",
      body: JSON.stringify({ transition: { id: transition.id } }),
    },
  );

  return `Transitioned ${key} to "${transition.to?.name || transition.name}"`;
}
