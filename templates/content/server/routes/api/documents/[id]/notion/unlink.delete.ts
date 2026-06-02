import { defineEventHandler } from "h3";
import { getDocumentOwnerEmail } from "../../../../../lib/notion.js";
import { unlinkDocumentFromNotion } from "../../../../../lib/notion-sync.js";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const owner = await getDocumentOwnerEmail(event, id);
  await unlinkDocumentFromNotion(owner, id);
  return { success: true };
});
