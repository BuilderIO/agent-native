import { defineEventHandler, readBody } from "h3";
import { getDocumentOwnerEmail } from "../../../../../lib/notion.js";
import { resolveDocumentSyncConflict } from "../../../../../lib/notion-sync.js";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const owner = await getDocumentOwnerEmail(event);
  return resolveDocumentSyncConflict(
    owner,
    event.context.params!.id,
    body.direction,
  );
});
