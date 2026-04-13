import { defineEventHandler } from "h3";
import { getDocumentOwnerEmail } from "../../../../../lib/notion.js";
import { unlinkDocumentFromNotion } from "../../../../../lib/notion-sync.js";

export default defineEventHandler(async (event) => {
  const owner = await getDocumentOwnerEmail(event);
  await unlinkDocumentFromNotion(owner, event.context.params!.id);
  return { success: true };
});
