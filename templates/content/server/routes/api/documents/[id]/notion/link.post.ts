import { readBody } from "@agent-native/core/server";
import { defineEventHandler } from "h3";

import { linkDocumentToNotionPage } from "../../../../../lib/notion-sync.js";
import { getDocumentOwnerEmail } from "../../../../../lib/notion.js";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const body = await readBody(event);
  const owner = await getDocumentOwnerEmail(event, id);
  return linkDocumentToNotionPage(owner, id, body.pageIdOrUrl);
});
