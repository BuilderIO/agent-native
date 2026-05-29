import { defineEventHandler } from "h3";
import { getDocumentOwnerEmail } from "../../../../../lib/notion.js";
import { createAndLinkNotionPage } from "../../../../../lib/notion-sync.js";
import { readBody } from "@agent-native/core/server";
import type { CreateNotionPageRequest } from "../../../../../../shared/api.js";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const body = await readBody<CreateNotionPageRequest>(event);
  const owner = await getDocumentOwnerEmail(event, id);
  return createAndLinkNotionPage(owner, id, body.parentPageIdOrUrl);
});
