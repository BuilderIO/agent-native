import { readBody } from "@agent-native/core/server";
import { createError, defineEventHandler } from "h3";

import { resolveDocumentSyncConflict } from "../../../../../lib/notion-sync.js";
import { getDocumentOwnerEmail } from "../../../../../lib/notion.js";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const body = await readBody(event);
  const direction = body?.direction;
  if (direction !== "pull" && direction !== "push") {
    throw createError({
      statusCode: 400,
      statusMessage: "direction must be 'pull' or 'push'",
    });
  }
  const owner = await getDocumentOwnerEmail(event, id);
  return resolveDocumentSyncConflict(owner, id, direction);
});
