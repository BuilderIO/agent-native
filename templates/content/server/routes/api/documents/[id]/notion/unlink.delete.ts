import { defineEventHandler } from "h3";
import { unlinkDocumentFromNotion } from "../../../../../lib/notion-sync.js";

export default defineEventHandler(async (event) => {
  await unlinkDocumentFromNotion(event.context.params!.id);
  return { success: true };
});
