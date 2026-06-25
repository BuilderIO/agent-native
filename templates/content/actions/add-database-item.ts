import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  isComputedPropertyType,
  type DocumentPropertyType,
} from "../shared/properties.js";
import { getContentDatabaseResponse } from "./_database-utils.js";
import { nanoid, normalizedValueJson } from "./_property-utils.js";

export default defineAction({
  description: "Add a page item to a content database table.",
  schema: z.object({
    databaseId: z.string().describe("Database ID"),
    title: z.string().optional().describe("New row page title"),
    propertyValues: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Initial property values keyed by property definition ID"),
  }),
  run: async ({ databaseId, title, propertyValues }) => {
    const db = getDb();
    const [database] = await db
      .select()
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.id, databaseId),
          isNull(schema.contentDatabases.deletedAt),
        ),
      );
    if (!database) throw new Error(`Database "${databaseId}" not found`);

    const access = await assertAccess(
      "document",
      database.documentId,
      "editor",
    );
    const databaseDocument = access.resource;
    const now = new Date().toISOString();

    const [maxDocPos] = await db
      .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.ownerEmail, database.ownerEmail),
          eq(schema.documents.parentId, database.documentId),
        ),
      );

    const [maxItemPos] = await db
      .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, databaseId));

    const documentId = nanoid();
    const itemId = nanoid();
    await db.insert(schema.documents).values({
      id: documentId,
      ownerEmail: database.ownerEmail,
      orgId: database.orgId,
      parentId: database.documentId,
      title: title?.trim() ?? "",
      content: "",
      icon: null,
      position: (maxDocPos?.max ?? -1) + 1,
      isFavorite: 0,
      hideFromSearch: databaseDocument.hideFromSearch ?? 0,
      visibility: databaseDocument.visibility ?? "private",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.contentDatabaseItems).values({
      id: itemId,
      ownerEmail: database.ownerEmail,
      orgId: database.orgId,
      databaseId,
      documentId,
      position: (maxItemPos?.max ?? -1) + 1,
      createdAt: now,
      updatedAt: now,
    });

    const inheritedShares = await db
      .select({
        principalType: schema.documentShares.principalType,
        principalId: schema.documentShares.principalId,
        role: schema.documentShares.role,
      })
      .from(schema.documentShares)
      .where(eq(schema.documentShares.resourceId, database.documentId));

    if (inheritedShares.length > 0) {
      await db.insert(schema.documentShares).values(
        inheritedShares.map((share) => ({
          id: nanoid(),
          resourceId: documentId,
          principalType: share.principalType,
          principalId: share.principalId,
          role: share.role,
          createdBy: getRequestUserEmail() ?? database.ownerEmail,
          createdAt: now,
        })),
      );
    }

    const initialValues = Object.entries(propertyValues ?? {});
    if (initialValues.length > 0) {
      const requestedPropertyIds = initialValues.map(
        ([propertyId]) => propertyId,
      );
      const definitions = await db
        .select()
        .from(schema.documentPropertyDefinitions)
        .where(
          and(
            eq(
              schema.documentPropertyDefinitions.ownerEmail,
              database.ownerEmail,
            ),
            eq(schema.documentPropertyDefinitions.databaseId, databaseId),
            inArray(
              schema.documentPropertyDefinitions.id,
              requestedPropertyIds,
            ),
          ),
        );
      const definitionById = new Map(
        definitions.map((definition) => [definition.id, definition]),
      );

      for (const [propertyId, value] of initialValues) {
        const definition = definitionById.get(propertyId);
        const type = definition?.type as DocumentPropertyType | undefined;
        if (!definition || !type || isComputedPropertyType(type)) continue;
        await db.insert(schema.documentPropertyValues).values({
          id: nanoid(),
          ownerEmail: database.ownerEmail,
          documentId,
          propertyId,
          valueJson: normalizedValueJson(type, value),
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      ...(await getContentDatabaseResponse(databaseId)),
      createdItemId: itemId,
      createdDocumentId: documentId,
    };
  },
});
