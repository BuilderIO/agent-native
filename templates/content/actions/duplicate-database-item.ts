import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getContentDatabaseResponse } from "./_database-utils.js";
import { nanoid } from "./_property-utils.js";

export default defineAction({
  description:
    "Duplicate exactly one page row in a content database, including stored property values. For two or more rows, use duplicate-database-items once instead of looping this action.",
  schema: z.object({
    itemId: z.string().optional().describe("Database item ID"),
    documentId: z.string().optional().describe("Database row document ID"),
    title: z.string().optional().describe("Optional title for the duplicate"),
  }),
  run: async ({ itemId, documentId, title }) => {
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
      .where(
        and(
          itemId
            ? eq(schema.contentDatabaseItems.id, itemId)
            : eq(schema.contentDatabaseItems.documentId, documentId!),
          isNull(schema.contentDatabases.deletedAt),
        ),
      );

    if (!row) throw new Error("Database row not found.");

    await assertAccess("document", row.database.documentId, "editor");
    await assertAccess("document", row.document.id, "viewer");

    const now = new Date().toISOString();
    const nextDocumentId = nanoid();
    const nextItemId = nanoid();
    const nextTitle =
      title?.trim() || `Copy of ${row.document.title.trim() || "Untitled"}`;
    const nextPosition = row.item.position + 1;

    const values = await db
      .select()
      .from(schema.documentPropertyValues)
      .where(eq(schema.documentPropertyValues.documentId, row.document.id));

    const inheritedShares = await db
      .select({
        principalType: schema.documentShares.principalType,
        principalId: schema.documentShares.principalId,
        role: schema.documentShares.role,
      })
      .from(schema.documentShares)
      .where(eq(schema.documentShares.resourceId, row.database.documentId));

    await db.transaction(async (tx) => {
      await tx
        .update(schema.contentDatabaseItems)
        .set({
          position: sql`${schema.contentDatabaseItems.position} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.contentDatabaseItems.databaseId, row.item.databaseId),
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
            eq(schema.documents.ownerEmail, row.document.ownerEmail),
            eq(schema.documents.parentId, row.database.documentId),
            gte(schema.documents.position, nextPosition),
          ),
        );

      await tx.insert(schema.documents).values({
        id: nextDocumentId,
        ownerEmail: row.document.ownerEmail,
        orgId: row.document.orgId,
        parentId: row.database.documentId,
        title: nextTitle,
        content: row.document.content,
        icon: row.document.icon,
        position: nextPosition,
        isFavorite: 0,
        hideFromSearch: row.document.hideFromSearch,
        visibility: row.document.visibility,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(schema.contentDatabaseItems).values({
        id: nextItemId,
        ownerEmail: row.item.ownerEmail,
        orgId: row.item.orgId,
        databaseId: row.item.databaseId,
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
            createdBy: getRequestUserEmail() ?? row.document.ownerEmail,
            createdAt: now,
          })),
        );
      }

      if (values.length > 0) {
        await tx.insert(schema.documentPropertyValues).values(
          values.map((value) => ({
            id: nanoid(),
            ownerEmail: row.document.ownerEmail,
            documentId: nextDocumentId,
            propertyId: value.propertyId,
            valueJson: value.valueJson,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      ...(await getContentDatabaseResponse(row.item.databaseId)),
      duplicatedItemId: nextItemId,
      duplicatedDocumentId: nextDocumentId,
    };
  },
});
