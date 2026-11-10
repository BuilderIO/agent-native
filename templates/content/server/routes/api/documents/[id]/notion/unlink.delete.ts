import { defineEventHandler } from "h3";

import { runAsRouteCaller } from "../../../../../lib/agent-lock-route.js";
import { unlinkDocumentFromNotion } from "../../../../../lib/notion-sync.js";
import { getDocumentOwnerEmail } from "../../../../../lib/notion.js";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const owner = await getDocumentOwnerEmail(event, id);
  await runAsRouteCaller(event, (ctx) =>
    unlinkDocumentFromNotion(owner, id, ctx),
  );
  return { success: true };
});
