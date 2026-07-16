import { readBody } from "@agent-native/core/server";
import { defineEventHandler } from "h3";

import { linkDocumentToNotionPage } from "../../../../../lib/notion-sync.js";
import { getDocumentNotionAuthority } from "../../../../../lib/notion.js";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const body = await readBody(event);
  const authority = await getDocumentNotionAuthority(event, id);
  return linkDocumentToNotionPage(
    authority.documentOwnerEmail,
    id,
    body.pageIdOrUrl,
    authority.callerEmail,
  );
});
