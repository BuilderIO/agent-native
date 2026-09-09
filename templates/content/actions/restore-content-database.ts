import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  assertContentDatabaseLifecycleAccess,
  collectInlineDatabaseOwnerBlockIds,
} from "./_content-database-lifecycle.js";
import { lockContentDatabaseMutation } from "./_content-database-mutation-lock.js";
import { lockDocumentsForLifecycle } from "./_document-lifecycle.js";
import { restoreDocumentSubtree } from "./delete-document.js";
import pullDocumentAction from "./pull-document.js";

export async function restoreLegacyContentDatabase(
  databaseId: string,
  expectedDocumentId: string,
) {
  const initial = await assertContentDatabaseLifecycleAccess(databaseId);
  function changed(): never {
    return fail("Trash item changed; refresh and review it again", {
      errorCode: "trash_scope_changed",
      statusCode: 409,
    });
  }
  if (initial.database.documentId !== expectedDocumentId) changed();
  return getDb().transaction(async (transaction) => {
    const tx = transaction as unknown as ReturnType<typeof getDb>;
    await lockContentDatabaseMutation(tx, databaseId);
    const [database] = await tx
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, databaseId))
      .limit(1);
    if (!database || !database.deletedAt) changed();
    for (const key of [
      "documentId",
      "ownerEmail",
      "ownerDocumentId",
      "ownerBlockId",
      "spaceId",
      "orgId",
    ] as const) {
      if (database[key] !== initial.database[key]) changed();
    }
    const locked = await lockDocumentsForLifecycle(tx, [
      database.documentId,
      ...(database.ownerDocumentId ? [database.ownerDocumentId] : []),
    ]);
    const backing = locked.find(
      (document) => document.id === expectedDocumentId,
    );
    if (
      !backing ||
      backing.trashedAt ||
      backing.trashRootId ||
      backing.ownerEmail !== initial.backingDocument.ownerEmail ||
      backing.parentId !== initial.backingDocument.parentId
    )
      changed();
    await assertAccess("document", expectedDocumentId, "viewer");
    if (
      database.ownerDocumentId &&
      backing.parentId === database.ownerDocumentId
    ) {
      await assertAccess("document", database.ownerDocumentId, "editor");
    } else {
      await assertAccess("document", expectedDocumentId, "admin");
    }
    const restored = await tx
      .update(schema.contentDatabases)
      .set({ deletedAt: null, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(schema.contentDatabases.id, databaseId),
          isNotNull(schema.contentDatabases.deletedAt),
        ),
      )
      .returning({ id: schema.contentDatabases.id });
    if (restored.length !== 1) changed();
    return {
      success: true,
      databaseId,
      documentId: expectedDocumentId,
      deletedAt: null,
      affectedDocumentIds: [expectedDocumentId],
      affectedDatabaseIds: [databaseId],
    };
  });
}

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
    expectedLegacyDocumentId: z
      .string()
      .optional()
      .describe(
        "Exact backing Page ID from legacyRestoreDatabaseId Trash metadata; restore only a legacy database whose Page has no trash markers.",
      ),
  }),
  run: async ({ databaseId, expectedLegacyDocumentId }) => {
    if (expectedLegacyDocumentId)
      return restoreLegacyContentDatabase(databaseId, expectedLegacyDocumentId);
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
