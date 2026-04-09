import { defineEventHandler } from "h3";
import { getDocumentOwnerEmail } from "../../../../../lib/notion.js";
import { refreshDocumentSyncStatus } from "../../../../../lib/notion-sync.js";
import { readBody } from "@agent-native/core/server";

export default defineEventHandler(async (event) => {
  const owner = await getDocumentOwnerEmail(event);
  const body = await readBody(event).catch(() => ({}));
  return refreshDocumentSyncStatus(owner, event.context.params!.id, {
    autoSync: !!body?.autoSync,
  });
});
