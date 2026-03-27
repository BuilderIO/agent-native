import { parseArgs } from "./_utils.js";
import { listNotionLinks } from "../server/lib/notion-sync.js";

export default async function main(args: string[]) {
  const opts = parseArgs(args);
  const owner = process.env.AGENT_USER_EMAIL || "local@localhost";
  const links = await listNotionLinks(owner);

  if (opts.format === "json") {
    console.log(JSON.stringify(links, null, 2));
    return;
  }

  if (links.length === 0) {
    console.log("No Notion-linked documents found.");
    return;
  }

  for (const link of links) {
    console.log(
      `${link.title} (${link.documentId}) -> ${link.remotePageId} [${link.state}]`,
    );
  }
}
