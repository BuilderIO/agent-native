import { defineEventHandler } from "h3";

import { pullDocumentFromNotion } from "../../../../../lib/notion-sync.js";
import { getDocumentNotionAuthority } from "../../../../../lib/notion.js";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const authority = await getDocumentNotionAuthority(event, id);
  return pullDocumentFromNotion(
    authority.documentOwnerEmail,
    id,
    true,
    {},
    authority.callerEmail,
  );
});
