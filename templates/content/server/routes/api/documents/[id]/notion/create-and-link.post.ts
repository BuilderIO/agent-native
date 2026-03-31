import { defineEventHandler } from "h3";
import { getDocumentOwnerEmail } from "../../../../../lib/notion.js";
import { createAndLinkNotionPage } from "../../../../../lib/notion-sync.js";

export default defineEventHandler(async (event) => {
  const owner = await getDocumentOwnerEmail(event);
  return createAndLinkNotionPage(owner, event.context.params!.id);
});
