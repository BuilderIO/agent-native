import { defineEventHandler } from "h3";
import { getDocumentOwnerEmail } from "../../../../lib/notion.js";
import { getDocumentSyncStatus } from "../../../../lib/notion-sync.js";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const owner = await getDocumentOwnerEmail(event, id);
  return getDocumentSyncStatus(owner, id);
});
