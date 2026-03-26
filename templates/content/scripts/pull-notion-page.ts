import { parseArgs, fail } from "./_utils.js";
import { pullDocumentFromNotion } from "../server/lib/notion-sync.js";

export default async function main(args: string[]) {
  const opts = parseArgs(args);
  const owner = process.env.AGENT_USER_EMAIL || "local@localhost";
  const documentId = opts.documentId || opts.id;

  if (!documentId) {
    fail("Usage: pnpm script pull-notion-page --documentId <id>");
  }

  const status = await pullDocumentFromNotion(owner, documentId);
  console.log(JSON.stringify(status, null, 2));
}
