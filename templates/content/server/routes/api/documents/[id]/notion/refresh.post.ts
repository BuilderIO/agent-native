import { readBody } from "@agent-native/core/server";
import { defineEventHandler } from "h3";

import { refreshDocumentSyncStatus } from "../../../../../lib/notion-sync.js";
import { getDocumentOwnerEmail } from "../../../../../lib/notion.js";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const body = (await readBody<{ autoSync?: boolean }>(event).catch(
    () => ({}),
  )) as { autoSync?: boolean };
  const owner = await getDocumentOwnerEmail(event, id);
  return refreshDocumentSyncStatus(owner, id, {
    autoSync: !!body?.autoSync,
  });
});
