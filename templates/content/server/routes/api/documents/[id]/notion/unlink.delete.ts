import { defineEventHandler } from "h3";

import { unlinkDocumentFromNotion } from "../../../../../lib/notion-sync.js";
import { getDocumentNotionAuthority } from "../../../../../lib/notion.js";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const authority = await getDocumentNotionAuthority(event, id);
  await unlinkDocumentFromNotion(authority.documentOwnerEmail, id);
  return { success: true };
});
