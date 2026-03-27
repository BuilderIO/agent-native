import { parseArgs, fail } from "./_utils.js";
import { linkDocumentToNotionPage } from "../server/lib/notion-sync.js";

export default async function main(args: string[]) {
  const opts = parseArgs(args);
  const owner = process.env.AGENT_USER_EMAIL || "local@localhost";
  const documentId = opts.documentId || opts.id;
  const pageIdOrUrl = opts.pageId || opts.url;

  if (!documentId || !pageIdOrUrl) {
    fail(
      "Usage: pnpm script link-notion-page --documentId <id> --pageId <id-or-url>",
    );
  }

  const status = await linkDocumentToNotionPage(owner, documentId, pageIdOrUrl);
  console.log(JSON.stringify(status, null, 2));
}
