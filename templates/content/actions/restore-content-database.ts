import { defineAction, isActionExecutionDeniedError } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  assertContentDatabaseLifecycleAccess,
  collectInlineDatabaseOwnerBlockIds,
} from "./_content-database-lifecycle.js";
import { runInheritedActionEntry } from "./_nested-action.js";
import pullDocumentAction from "./pull-document.js";

async function shouldClearStaleInlineOwnership(args: {
  ownerDocumentId: string | null;
  ownerBlockId: string | null;
  context?: import("@agent-native/core/action").ActionRunContext;
}) {
  if (!args.ownerDocumentId || !args.ownerBlockId) return false;
  let content: string | null = null;
  try {
    const host = await runInheritedActionEntry<{
      content?: string | null;
    }>({
      entry: pullDocumentAction,
      actionName: "pull-document",
      args: { id: args.ownerDocumentId, format: "markdown" },
      parentContext: args.context,
    });
    content = String(host.content ?? "");
  } catch (error) {
    if (isActionExecutionDeniedError(error)) throw error;
    const hostAccess = await resolveAccess("document", args.ownerDocumentId);
    if (!hostAccess) return false;
    content = String(hostAccess.resource.content ?? "");
  }

  const parsed = await collectInlineDatabaseOwnerBlockIds(content);
  return parsed.ok && !parsed.ownerBlockIds.has(args.ownerBlockId);
}

export default defineAction({
  description: "Restore a soft-deleted content database.",
  schema: z.object({
    databaseId: z.string().describe("Content database ID"),
  }),
  run: async ({ databaseId }, context) => {
    const ownership = await assertContentDatabaseLifecycleAccess(databaseId);
    const db = getDb();
    const now = new Date().toISOString();
    const clearInlineOwnership = await shouldClearStaleInlineOwnership({
      ownerDocumentId: ownership.database.ownerDocumentId,
      ownerBlockId: ownership.database.ownerBlockId,
      context,
    });

    await db
      .update(schema.contentDatabases)
      .set({
        deletedAt: null,
        updatedAt: now,
        ...(clearInlineOwnership
          ? { ownerDocumentId: null, ownerBlockId: null }
          : {}),
      })
      .where(eq(schema.contentDatabases.id, databaseId));

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      success: true,
      databaseId,
      documentId: ownership.database.documentId,
      deletedAt: null,
    };
  },
});
