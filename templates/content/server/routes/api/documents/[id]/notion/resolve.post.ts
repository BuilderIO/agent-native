import { readBody } from "@agent-native/core/server";
import { createError, defineEventHandler } from "h3";

import { resolveDocumentSyncConflict } from "../../../../../lib/notion-sync.js";
import { getDocumentNotionAuthority } from "../../../../../lib/notion.js";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const body = await readBody(event);
  const direction = body?.direction;
  // resolveDocumentSyncConflict treats anything other than the literal
  // "pull" as "push" (a destructive force-push). Validate here so a missing
  // or misspelled field (e.g. `{ dir: "pull" }`) 400s instead of silently
  // overwriting the Notion page. The action counterpart already enforces
  // this via z.enum(["pull", "push"]).
  if (direction !== "pull" && direction !== "push") {
    throw createError({
      statusCode: 400,
      statusMessage: "direction must be 'pull' or 'push'",
    });
  }
  const authority = await getDocumentNotionAuthority(event, id);
  return resolveDocumentSyncConflict(
    authority.documentOwnerEmail,
    id,
    direction,
    authority.callerEmail,
  );
});
