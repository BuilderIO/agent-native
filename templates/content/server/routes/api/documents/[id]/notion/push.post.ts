import { defineEventHandler } from "h3";

import { pushDocumentToNotion } from "../../../../../lib/notion-sync.js";
import { getDocumentNotionAuthority } from "../../../../../lib/notion.js";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const authority = await getDocumentNotionAuthority(event, id);
  return pushDocumentToNotion(
    authority.documentOwnerEmail,
    id,
    false,
    undefined,
    authority.callerEmail,
  );
});
