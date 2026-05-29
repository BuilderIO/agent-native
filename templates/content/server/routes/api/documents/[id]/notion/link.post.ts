import { defineEventHandler } from "h3";
import { getDocumentOwnerEmail } from "../../../../../lib/notion.js";
import { linkDocumentToNotionPage } from "../../../../../lib/notion-sync.js";
import { readBody } from "@agent-native/core/server";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const body = await readBody(event);
  const owner = await getDocumentOwnerEmail(event, id);
  return linkDocumentToNotionPage(owner, id, body.pageIdOrUrl);
});
