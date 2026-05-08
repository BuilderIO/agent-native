import { defineEventHandler } from "h3";
import { getDocumentOwnerEmail } from "../../../../../lib/notion.js";
import { createAndLinkNotionPage } from "../../../../../lib/notion-sync.js";
import { readBody } from "@agent-native/core/server";
import type { CreateNotionPageRequest } from "../../../../../../shared/api.js";

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateNotionPageRequest>(event);
  const owner = await getDocumentOwnerEmail(event);
  return createAndLinkNotionPage(
    owner,
    event.context.params!.id,
    body.parentPageIdOrUrl,
  );
});
