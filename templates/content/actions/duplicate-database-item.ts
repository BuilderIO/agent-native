import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  documentCreationAttribution,
  requireDocumentRequestActor,
} from "../server/lib/document-attribution.js";
import {
  lockContentDatabaseMutation,
  touchContentDatabase,
} from "./_content-database-mutation-lock.js";
import { ensureDocumentFilesMembership } from "./_content-files.js";
import { assertNotWorkspaceCatalogDocuments } from "./_content-space-catalog-guards.js";
import { getContentDatabaseResponse } from "./_database-utils.js";
import { nanoid } from "./_property-utils.js";

export default defineAction({
  description:
    "Duplicate exactly one page row in a content collection, including stored property values. For two or more rows, use duplicate-database-items once instead of looping this action.",
  schema: z.object({
    itemId: z.string().optional().describe("Collection item ID"),
    documentId: z.string().optional().describe("Collection row document ID"),
    title: z.string().optional().describe("Optional title for the duplicate"),
  }),
  run: async ({ itemId, documentId, title }, ctx) => {
    if (!itemId && !documentId) {
      throw new Error("Either itemId or documentId is required.");
    }

    const db = getDb();
    const [row] = await db
      .select({
        item: schema.contentDatabaseItems,
        database: schema.contentDatabases,
        document: schema.documents,
      })
      .from(schema.contentDatabaseItems)
      .innerJoin(
        schema.contentDatabases,
        eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
      )
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabaseItems.documentId),
      )
      .leftJoin(
        schema.contentSpaces,
        eq(schema.contentSpaces.filesDatabaseId, schema.contentDatabases.id),
      )
      .where(
        and(
          itemId
            ? eq(schema.contentDatabaseItems.id, itemId)
            : eq(schema.contentDatabaseItems.documentId, documentId!),
          isNull(schema.contentDatabases.deletedAt),
          isNull(schema.documents.trashedAt),
        ),
      )
      // A Page can belong to several collections (Files, personal pins, other
      // collections). When only the Page is named, duplicate it in its own
      // space's Files rather than whichever membership the database returns.
      .orderBy(
        sql`case when ${schema.contentSpaces.filesDatabaseId} is not null and ${schema.contentDatabases.spaceId} = ${schema.documents.spaceId} then 0 else 1 end`,
      )
      .limit(1);

    if (!row) throw new Error("Database row not found.");
    if (!row.database.spaceId) {
      throw new Error("Database does not belong to a Content space.");
    }
    if (row.document.spaceId !== row.database.spaceId) {
      throw new Error("Cannot duplicate a database row across Content spaces.");
    }

    await assertAccess("document", row.database.documentId, "editor");
    await assertAccess("document", row.document.id, "viewer");
    await assertNotWorkspaceCatalogDocuments(
      db,
      [row.document.id],
      "duplicated",
    );

    const now = new Date().toISOString();
    const actor = requireDocumentRequestActor(ctx);
    const nextDocumentId = nanoid();
    const nextItemId = nanoid();
    const inheritedShares = await db
      .select({
        principalType: schema.documentShares.principalType,
        principalId: schema.documentShares.principalId,
        role: schema.documentShares.role,
      })
      .from(schema.documentShares)
      .where(eq(schema.documentShares.resourceId, row.database.documentId));

    await db.transaction(async (tx) => {
      await lockContentDatabaseMutation(
        tx as unknown as ReturnType<typeof getDb>,
        row.database.id,
      );
      await touchContentDatabase(
        tx as unknown as ReturnType<typeof getDb>,
        row.database.id,
        now,
      );
      const [lockedRow] = await tx
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
            eq(schema.contentDatabaseItems.id, row.item.id),
            eq(schema.contentDatabaseItems.databaseId, row.database.id),
            eq(schema.contentDatabaseItems.documentId, row.document.id),
            isNull(schema.documents.trashedAt),
          ),
        );
      if (!lockedRow) {
        throw new Error("Database row changed while duplication was waiting.");
      }
      if (lockedRow.document.spaceId !== row.database.spaceId) {
        throw new Error(
          "Cannot duplicate a database row across Content spaces.",
        );
      }

      const nextTitle =
        title?.trim() ||
        `Copy of ${lockedRow.document.title.trim() || "Untitled"}`;
      const nextPosition = lockedRow.item.position + 1;
      // The copy sits beside its original: collection rows keep the collection
      // page as parent, and Files pages keep their place in the page tree
      // (including top-level pages, whose parent is null).
      const duplicateParentId =
        row.database.systemRole === "files"
          ? lockedRow.document.parentId
          : row.database.documentId;
      const values = await tx
        .select()
        .from(schema.documentPropertyValues)
        .where(
          eq(schema.documentPropertyValues.documentId, lockedRow.document.id),
        );
      const [claimedSource] = await tx
        .select({ id: schema.contentDatabaseItemKeyClaims.id })
        .from(schema.contentDatabaseItemKeyClaims)
        .where(
          and(
            eq(schema.contentDatabaseItemKeyClaims.databaseId, row.database.id),
            eq(schema.contentDatabaseItemKeyClaims.documentId, row.document.id),
          ),
        )
        .limit(1);
      if (claimedSource) {
        throw new Error(
          "Rows with active stable-key claims cannot be duplicated.",
        );
      }
      await tx
        .update(schema.contentDatabaseItems)
        .set({
          position: sql`${schema.contentDatabaseItems.position} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(
              schema.contentDatabaseItems.databaseId,
              lockedRow.item.databaseId,
            ),
            gte(schema.contentDatabaseItems.position, nextPosition),
          ),
        );

      await tx
        .update(schema.documents)
        .set({
          position: sql`${schema.documents.position} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.documents.ownerEmail, lockedRow.document.ownerEmail),
            duplicateParentId === null
              ? and(
                  // Top-level siblings are the same space and root section.
                  isNull(schema.documents.parentId),
                  eq(schema.documents.spaceId, row.database.spaceId!),
                  eq(
                    schema.documents.visibility,
                    lockedRow.document.visibility,
                  ),
                  lockedRow.document.orgId
                    ? eq(schema.documents.orgId, lockedRow.document.orgId)
                    : isNull(schema.documents.orgId),
                )
              : eq(schema.documents.parentId, duplicateParentId),
            gte(schema.documents.position, nextPosition),
          ),
        );

      await tx.insert(schema.documents).values({
        id: nextDocumentId,
        spaceId: row.database.spaceId,
        ownerEmail: lockedRow.document.ownerEmail,
        orgId: lockedRow.document.orgId,
        parentId: duplicateParentId,
        title: nextTitle,
        content: lockedRow.document.content,
        icon: lockedRow.document.icon,
        position: nextPosition,
        isFavorite: 0,
        hideFromSearch: lockedRow.document.hideFromSearch,
        visibility: lockedRow.document.visibility,
        ...documentCreationAttribution(actor),
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(schema.contentDatabaseItems).values({
        id: nextItemId,
        ownerEmail: lockedRow.item.ownerEmail,
        orgId: lockedRow.item.orgId,
        databaseId: lockedRow.item.databaseId,
        documentId: nextDocumentId,
        position: nextPosition,
        createdAt: now,
        updatedAt: now,
      });

      if (inheritedShares.length > 0) {
        await tx.insert(schema.documentShares).values(
          inheritedShares.map((share) => ({
            id: nanoid(),
            resourceId: nextDocumentId,
            principalType: share.principalType,
            principalId: share.principalId,
            role: share.role,
            createdBy: actor,
            createdAt: now,
          })),
        );
      }

      if (values.length > 0) {
        await tx.insert(schema.documentPropertyValues).values(
          values.map((value) => ({
            id: nanoid(),
            ownerEmail: lockedRow.document.ownerEmail,
            documentId: nextDocumentId,
            propertyId: value.propertyId,
            valueJson: value.valueJson,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }

      await ensureDocumentFilesMembership(tx, nextDocumentId, now);
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    const response = await getContentDatabaseResponse(row.item.databaseId, {
      limit: 100,
      offset: 0,
    });
    const duplicatedItem =
      response.items.find((item) => item.id === nextItemId) ??
      (
        await getContentDatabaseResponse(row.item.databaseId, {
          limit: 1,
          offset: 0,
          documentIds: [nextDocumentId],
        })
      ).items.find((item) => item.id === nextItemId);
    return {
      ...response,
      duplicatedItems: duplicatedItem ? [duplicatedItem] : [],
      duplicatedItemId: nextItemId,
      duplicatedDocumentId: nextDocumentId,
    };
  },
});
