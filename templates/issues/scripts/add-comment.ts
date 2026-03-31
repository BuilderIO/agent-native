import { parseArgs } from "@agent-native/core";
import { getAtlassianClient, jiraUrl, jiraFetch } from "./helpers.js";

export default async function (args: string[]) {
  const { key, body } = parseArgs(args);

  if (!key) return "Error: --key is required";
  if (!body) return "Error: --body is required";

  const client = await getAtlassianClient();

  const adfBody = {
    version: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: body as string }],
      },
    ],
  };

  const result = await jiraFetch(
    jiraUrl(client.cloudId, `/issue/${key}/comment`),
    client.accessToken,
    {
      method: "POST",
      body: JSON.stringify({ body: adfBody }),
    },
  );

  return `Added comment to ${key} (id: ${result.id})`;
}
