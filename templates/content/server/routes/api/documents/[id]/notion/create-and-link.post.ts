import { readBody } from "@agent-native/core/server";
import { createError, defineEventHandler } from "h3";

import type { CreateNotionPageRequest } from "../../../../../../shared/api.js";
import { runAsRouteCaller } from "../../../../../lib/agent-lock-route.js";
import { createAndLinkNotionPage } from "../../../../../lib/notion-sync.js";
import { getDocumentOwnerEmail } from "../../../../../lib/notion.js";

export default defineEventHandler(async (event) => {
  const id = event.context.params?.id;
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: "id is required" });
  }
  const body = await readBody<CreateNotionPageRequest>(event);
  const owner = await getDocumentOwnerEmail(event, id);
  return runAsRouteCaller(event, (ctx) =>
    createAndLinkNotionPage(owner, id, body.parentPageIdOrUrl, ctx),
  );
});
