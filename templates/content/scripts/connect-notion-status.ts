import { parseArgs } from "./_utils.js";
import { getNotionConnectionForOwner } from "../server/lib/notion.js";

export default async function main(args: string[]) {
  const opts = parseArgs(args);
  const owner = process.env.AGENT_USER_EMAIL || "local@localhost";
  const connection = await getNotionConnectionForOwner(owner);
  const payload = {
    connected: Boolean(connection),
    workspaceName: connection?.workspaceName ?? null,
    workspaceId: connection?.workspaceId ?? null,
  };

  if (opts.format === "json" || true) {
    console.log(JSON.stringify(payload, null, 2));
  }
}
