import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  lockContentDatabaseMutation,
  touchContentDatabase,
} from "./_content-database-mutation-lock.js";
import { ensureDocumentsFilesMembership } from "./_content-files.js";
import { assertNotWorkspaceCatalogDocuments } from "./_content-space-catalog-guards.js";
import {
  databaseRowBatchSchema,
  resolveDatabaseRowsForBatch,
} from "./_database-row-batch.js";
import { getContentDatabaseResponse } from "./_database-utils.js";
import { nanoid } from "./_property-utils.js";

export default defineAction({
  description:
    "Duplicate multiple page rows in a content database in one atomic batch. Use this for two or more selected/named rows instead of looping duplicate-database-item.",
  schema: databaseRowBatchSchema,
  run: async (args) => {
    const db = getDb();
    const { database, rows } = await resolveDatabaseRowsForBatch(args);
    if (!database.spaceId) {
      throw new Error("Database does not belong to a Content space.");
    }
    if (rows.some((row) => row.document.spaceId !== database.spaceId)) {
      throw new Error("Cannot duplicate database rows across Content spaces.");
    }

    await assertAccess("document", database.documentId, "editor");
    for (const row of rows) {
      await assertAccess("document", row.document.id, "viewer");
    }

    const sourceDocumentIds = rows.map((row) => row.document.id);
    await assertNotWorkspaceCatalogDocuments(
      db,
      sourceDocumentIds,
      "duplicated",
    );
    const sourceItemIds = rows.map((row) => row.item.id);
    const now = new Date().toISOString();
    const currentUserEmail = getRequestUserEmail() ?? database.ownerEmail;

    const inheritedShares = await db
      .select({
        principalType: schema.documentShares.principalType,
        principalId: schema.documentShares.principalId,
        role: schema.documentShares.role,
      })
      .from(schema.documentShares)
      .where(eq(schema.documentShares.resourceId, database.documentId));

    const duplicates = rows.map((row) => ({
      sourceItemId: row.item.id,
      sourceDocumentId: row.document.id,
      duplicatedItemId: nanoid(),
      duplicatedDocumentId: nanoid(),
    }));

    await db.transaction(async (tx) => {
      await lockContentDatabaseMutation(
        tx as unknown as ReturnType<typeof getDb>,
        database.id,
      );
      await touchContentDatabase(
        tx as unknown as ReturnType<typeof getDb>,
        database.id,
        now,
      );
      const lockedRows = await tx
        .select({
          item: schema.contentDatabaseItems,
          document: schema.documents,
        })
        .from(schema.contentDatabaseItems)
        .innerJoin(
          schema.documents,
          eq(schema.documents.id, schema.contentDatabaseItems.documentId),
        )
        .where(
          and(
            eq(schema.contentDatabaseItems.databaseId, database.id),
            inArray(schema.contentDatabaseItems.id, sourceItemIds),
            isNull(schema.documents.trashedAt),
          ),
        )
        .orderBy(asc(schema.contentDatabaseItems.position));
      const lockedRowsByItemId = new Map(
        lockedRows.map((lockedRow) => [lockedRow.item.id, lockedRow]),
      );
      if (
        lockedRows.length !== rows.length ||
        rows.some(
          (row) =>
            lockedRowsByItemId.get(row.item.id)?.document.id !==
            row.document.id,
        )
      ) {
        throw new Error("Database rows changed while duplication was waiting.");
      }
      if (
        lockedRows.some(
          (lockedRow) => lockedRow.document.spaceId !== database.spaceId,
        )
      ) {
        throw new Error(
          "Cannot duplicate database rows across Content spaces.",
        );
      }
      const insertionPosition =
        Math.max(...lockedRows.map((lockedRow) => lockedRow.item.position)) + 1;
      const lockedDuplicates = duplicates.map((duplicate, index) => ({
        ...duplicate,
        position: insertionPosition + index,
        row: lockedRowsByItemId.get(duplicate.sourceItemId)!,
      }));
      const values =
        sourceDocumentIds.length > 0
          ? await tx
              .select()
              .from(schema.documentPropertyValues)
              .where(
                inArray(
                  schema.documentPropertyValues.documentId,
                  sourceDocumentIds,
                ),
              )
          : [];
      const valuesByDocumentId = new Map<
        string,
        Array<typeof schema.documentPropertyValues.$inferSelect>
      >();
      for (const value of values) {
        const list = valuesByDocumentId.get(value.documentId) ?? [];
        list.push(value);
        valuesByDocumentId.set(value.documentId, list);
      }
      await tx
        .update(schema.contentDatabaseItems)
        .set({
          position: sql`${schema.contentDatabaseItems.position} + ${lockedDuplicates.length}`,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.contentDatabaseItems.databaseId, database.id),
            gte(schema.contentDatabaseItems.position, insertionPosition),
          ),
        );

      await tx
        .update(schema.documents)
        .set({
          position: sql`${schema.documents.position} + ${lockedDuplicates.length}`,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.documents.ownerEmail, database.ownerEmail),
            eq(schema.documents.parentId, database.documentId),
            gte(schema.documents.position, insertionPosition),
          ),
        );

      await tx.insert(schema.documents).values(
        lockedDuplicates.map((duplicate) => ({
          id: duplicate.duplicatedDocumentId,
          spaceId: database.spaceId,
          ownerEmail: duplicate.row.document.ownerEmail,
          orgId: duplicate.row.document.orgId,
          parentId: database.documentId,
          title: `Copy of ${duplicate.row.document.title.trim() || "Untitled"}`,
          content: duplicate.row.document.content,
          icon: duplicate.row.document.icon,
          position: duplicate.position,
          isFavorite: 0,
          hideFromSearch: duplicate.row.document.hideFromSearch,
          visibility: duplicate.row.document.visibility,
          createdAt: now,
          updatedAt: now,
        })),
      );

      await tx.insert(schema.contentDatabaseItems).values(
        lockedDuplicates.map((duplicate) => ({
          id: duplicate.duplicatedItemId,
          ownerEmail: duplicate.row.item.ownerEmail,
          orgId: duplicate.row.item.orgId,
          databaseId: database.id,
          documentId: duplicate.duplicatedDocumentId,
          position: duplicate.position,
          createdAt: now,
          updatedAt: now,
        })),
      );

      const duplicatedValues = lockedDuplicates.flatMap((duplicate) =>
        (valuesByDocumentId.get(duplicate.sourceDocumentId) ?? []).map(
          (value) => ({
            id: nanoid(),
            ownerEmail: duplicate.row.document.ownerEmail,
            documentId: duplicate.duplicatedDocumentId,
            propertyId: value.propertyId,
            valueJson: value.valueJson,
            createdAt: now,
            updatedAt: now,
          }),
        ),
      );
      if (duplicatedValues.length > 0) {
        await tx.insert(schema.documentPropertyValues).values(duplicatedValues);
      }

      if (inheritedShares.length > 0) {
        await tx.insert(schema.documentShares).values(
          lockedDuplicates.flatMap((duplicate) =>
            inheritedShares.map((share) => ({
              id: nanoid(),
              resourceId: duplicate.duplicatedDocumentId,
              principalType: share.principalType,
              principalId: share.principalId,
              role: share.role,
              createdBy: currentUserEmail,
              createdAt: now,
            })),
          ),
        );
      }
      await ensureDocumentsFilesMembership(
        tx,
        lockedDuplicates.map((duplicate) => duplicate.duplicatedDocumentId),
        now,
      );
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    const response = await getContentDatabaseResponse(database.id, {
      limit: 100,
      offset: 0,
    });
    const duplicatedPage = await getContentDatabaseResponse(database.id, {
      limit: duplicates.length,
      offset: 0,
      documentIds: duplicates.map(
        (duplicate) => duplicate.duplicatedDocumentId,
      ),
    });
    const duplicatedItemIds = new Set(
      duplicates.map((duplicate) => duplicate.duplicatedItemId),
    );
    const duplicatedItems = duplicatedPage.items.filter((item) =>
      duplicatedItemIds.has(item.id),
    );
    return {
      ...response,
      duplicatedItems,
      duplicatedItemId: duplicates[0]?.duplicatedItemId,
      duplicatedDocumentId: duplicates[0]?.duplicatedDocumentId,
      duplicatedItemIds: duplicates.map(
        (duplicate) => duplicate.duplicatedItemId,
      ),
      duplicatedDocumentIds: duplicates.map(
        (duplicate) => duplicate.duplicatedDocumentId,
      ),
      sourceItemIds,
      sourceDocumentIds,
      sourceToDuplicate: duplicates.map((duplicate) => ({
        sourceItemId: duplicate.sourceItemId,
        sourceDocumentId: duplicate.sourceDocumentId,
        duplicatedItemId: duplicate.duplicatedItemId,
        duplicatedDocumentId: duplicate.duplicatedDocumentId,
      })),
      duplicatedCount: duplicates.length,
    };
  },
});
