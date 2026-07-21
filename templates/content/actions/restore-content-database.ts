import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { resolveAccess } from "@agent-native/core/sharing";
import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  assertContentDatabaseLifecycleAccess,
  collectInlineDatabaseOwnerBlockIds,
} from "./_content-database-lifecycle.js";
import { restoreDocumentSubtree } from "./delete-document.js";
import pullDocumentAction from "./pull-document.js";

async function shouldClearStaleInlineOwnership(args: {
  ownerDocumentId: string | null;
  ownerBlockId: string | null;
}) {
  if (!args.ownerDocumentId || !args.ownerBlockId) return false;
  let content: string | null = null;
  try {
    const host = await pullDocumentAction.run({
      id: args.ownerDocumentId,
      format: "markdown",
    });
    content = String(host.content ?? "");
  } catch {
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
  run: async ({ databaseId }) => {
    const ownership = await assertContentDatabaseLifecycleAccess(databaseId);
    const db = getDb();
    const now = new Date().toISOString();
    const clearInlineOwnership = await shouldClearStaleInlineOwnership({
      ownerDocumentId: ownership.database.ownerDocumentId,
      ownerBlockId: ownership.database.ownerBlockId,
    });

    await db.transaction(async (tx) => {
      const [backingDocument] = await tx
        .select({
          trashedAt: schema.documents.trashedAt,
          trashRootId: schema.documents.trashRootId,
        })
        .from(schema.documents)
        .where(eq(schema.documents.id, ownership.database.documentId))
        .limit(1);
      if (!backingDocument) {
        throw new Error(`Database "${databaseId}" not found`);
      }
      if (
        backingDocument.trashedAt &&
        backingDocument.trashRootId !== ownership.database.documentId
      ) {
        throw new Error("Restore the parent Trash item instead");
      }

      const restoredDocumentIds = await restoreDocumentSubtree(
        tx as unknown as ReturnType<typeof getDb>,
        ownership.database.documentId,
        ownership.database.ownerEmail,
      );
      if (
        backingDocument.trashedAt &&
        !restoredDocumentIds.includes(ownership.database.documentId)
      ) {
        throw new Error("Database backing page was not restored");
      }
      await tx
        .update(schema.contentDatabases)
        .set({
          deletedAt: null,
          updatedAt: now,
          ...(clearInlineOwnership
            ? { ownerDocumentId: null, ownerBlockId: null }
            : {}),
        })
        .where(
          and(
            eq(schema.contentDatabases.id, databaseId),
            isNotNull(schema.contentDatabases.deletedAt),
          ),
        );
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      success: true,
      databaseId,
      documentId: ownership.database.documentId,
      deletedAt: null,
    };
  },
});
