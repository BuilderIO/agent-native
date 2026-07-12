import { defineEventHandler } from "h3";

import { pullDocumentFromNotion } from "../../../../../lib/notion-sync.js";
import { getDocumentOwnerEmail } from "../../../../../lib/notion.js";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const owner = await getDocumentOwnerEmail(event, id);
  return pullDocumentFromNotion(owner, id, true);
});
