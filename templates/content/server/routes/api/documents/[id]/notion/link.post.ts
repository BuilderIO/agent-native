import { defineEventHandler, readBody } from "h3";
import { getDocumentOwnerEmail } from "../../../../../lib/notion.js";
import { linkDocumentToNotionPage } from "../../../../../lib/notion-sync.js";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const owner = await getDocumentOwnerEmail(event);
  return linkDocumentToNotionPage(
    owner,
    event.context.params!.id,
    body.pageIdOrUrl,
  );
});
