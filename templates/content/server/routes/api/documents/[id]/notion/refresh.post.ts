import { readBody } from "@agent-native/core/server";
import { defineEventHandler } from "h3";

import { refreshDocumentSyncStatus } from "../../../../../lib/notion-sync.js";
import { getDocumentNotionAuthority } from "../../../../../lib/notion.js";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const body = (await readBody<{ autoSync?: boolean }>(event).catch(
    () => ({}),
  )) as { autoSync?: boolean };
  const authority = await getDocumentNotionAuthority(event, id);
  return refreshDocumentSyncStatus(
    authority.documentOwnerEmail,
    id,
    { autoSync: !!body?.autoSync },
    authority.callerEmail,
  );
});
