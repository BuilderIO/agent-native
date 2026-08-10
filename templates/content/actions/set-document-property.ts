import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  blocksStorageTarget,
  isBlocksPropertyType,
  isComputedPropertyType,
  normalizePropertyValue,
  parsePropertyOptions,
  type DocumentPropertyType,
} from "../shared/properties.js";
import { lockContentDatabaseMutation } from "./_content-database-mutation-lock.js";
import { resolveContentDocumentAccess } from "./_content-document-access.js";
import { lockDatabaseMemberships } from "./_database-membership-lock.js";
import {
  getDatabaseById,
  listPropertiesForDatabaseDocuments,
  nanoid,
  normalizedValueJson,
} from "./_property-utils.js";

export default defineAction({
  description: "Set a Notion-style property value on a document.",
  schema: z.object({
    documentId: z.string().describe("Document ID (required)"),
    databaseId: z
      .string()
      .optional()
      .describe(
        "Database ID that owns the property; omit only for context-free entry points",
      ),
    propertyId: z.string().describe("Property definition ID"),
    value: z.unknown().describe("Value for the property type"),
  }),
  run: async ({ documentId, databaseId, propertyId, value }) => {
    const db = getDb();
    const [definition] = await db
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.id, propertyId));
    if (!definition) throw new Error(`Property "${propertyId}" not found`);
    if (!definition.databaseId) {
      throw new Error(`Property "${propertyId}" is not attached to a database`);
    }
    if (databaseId && definition.databaseId !== databaseId) {
      throw new Error(`Property "${propertyId}" not found`);
    }
    const database = await getDatabaseById(definition.databaseId);
    if (!database) throw new Error("Document database not found.");
    await assertAccess("document", database.documentId, "editor");
    if (definition.systemRole) {
      throw new Error("System properties are derived and cannot be edited.");
    }
    const access = await resolveContentDocumentAccess(documentId);
    if (!access) throw new Error(`Document "${documentId}" not found`);
    const document = access.resource;
    const [membership] = await db
      .select({ id: schema.contentDatabaseItems.id })
      .from(schema.contentDatabaseItems)
      .where(
        and(
          eq(schema.contentDatabaseItems.databaseId, database.id),
          eq(schema.contentDatabaseItems.documentId, documentId),
        ),
      );
    if (!membership) throw new Error("Document is not part of this database.");
    const type = definition.type as DocumentPropertyType;
    if (isComputedPropertyType(type)) {
      throw new Error("Computed properties cannot be edited.");
    }

    const now = new Date().toISOString();

    // Blocks fields store rich-text content, not a property-values row. The
    // primary "Content" field writes to the document body; additional Blocks
    // fields write to their own independent store.
    if (isBlocksPropertyType(type)) {
      await assertAccess("document", documentId, "editor");
      const normalized = normalizePropertyValue(type, value);
      const content = typeof normalized === "string" ? normalized : "";
      let target = blocksStorageTarget(
        parsePropertyOptions(definition.optionsJson),
      );
      await db.transaction(async (tx) => {
        await lockDatabaseMemberships(tx, [membership.id]);
        const [lockedDefinition] = await tx
          .select()
          .from(schema.documentPropertyDefinitions)
          .where(eq(schema.documentPropertyDefinitions.id, propertyId));
        const [lockedMembership] = await tx
          .select({ id: schema.contentDatabaseItems.id })
          .from(schema.contentDatabaseItems)
          .where(
            and(
              eq(schema.contentDatabaseItems.id, membership.id),
              eq(schema.contentDatabaseItems.databaseId, database.id),
              eq(schema.contentDatabaseItems.documentId, documentId),
            ),
          );
        if (!lockedDefinition || lockedDefinition.databaseId !== database.id) {
          throw new Error(`Property "${propertyId}" not found`);
        }
        if (!lockedMembership) {
          throw new Error("Document is not part of this database.");
        }
        if (
          !isBlocksPropertyType(lockedDefinition.type as DocumentPropertyType)
        ) {
          throw new Error(
            "Property type changed before the operation completed.",
          );
        }
        target = blocksStorageTarget(
          parsePropertyOptions(lockedDefinition.optionsJson),
        );
        if (target === "document_body") {
          await tx
            .update(schema.documents)
            .set({ content, updatedAt: now })
            .where(eq(schema.documents.id, documentId));
        } else {
          await tx
            .insert(schema.documentBlockFieldContents)
            .values({
              id: nanoid(),
              ownerEmail: database.ownerEmail,
              documentId,
              propertyId,
              content,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [
                schema.documentBlockFieldContents.documentId,
                schema.documentBlockFieldContents.propertyId,
              ],
              set: { content, updatedAt: now },
            });
        }
      });
      return {
        documentId,
        databaseId: database.id,
        properties:
          (
            await listPropertiesForDatabaseDocuments(database.id, [
              {
                ...document,
                content:
                  target === "document_body" ? content : document.content,
                updatedAt: now,
              },
            ])
          ).get(documentId) ?? [],
      };
    }

    const valueJson = normalizedValueJson(type, value);
    await db.transaction(async (tx) => {
      await lockContentDatabaseMutation(
        tx as unknown as ReturnType<typeof getDb>,
        database.id,
      );
      const [lockedDatabase] = await tx
        .select({
          id: schema.contentDatabases.id,
          naturalKeyPropertyId: schema.contentDatabases.naturalKeyPropertyId,
        })
        .from(schema.contentDatabases)
        .where(
          and(
            eq(schema.contentDatabases.id, database.id),
            eq(schema.contentDatabases.documentId, database.documentId),
            eq(schema.contentDatabases.ownerEmail, database.ownerEmail),
            isNull(schema.contentDatabases.deletedAt),
          ),
        );
      if (!lockedDatabase) throw new Error("Database is no longer active.");
      await lockDatabaseMemberships(tx, [membership.id]);
      const [lockedDefinition] = await tx
        .select()
        .from(schema.documentPropertyDefinitions)
        .where(eq(schema.documentPropertyDefinitions.id, propertyId));
      const [lockedMembership] = await tx
        .select({ id: schema.contentDatabaseItems.id })
        .from(schema.contentDatabaseItems)
        .where(
          and(
            eq(schema.contentDatabaseItems.id, membership.id),
            eq(schema.contentDatabaseItems.databaseId, database.id),
            eq(schema.contentDatabaseItems.documentId, documentId),
          ),
        );
      if (!lockedDefinition || lockedDefinition.databaseId !== database.id) {
        throw new Error(`Property "${propertyId}" not found`);
      }
      if (!lockedMembership) {
        throw new Error("Document is not part of this database.");
      }
      const lockedType = lockedDefinition.type as DocumentPropertyType;
      if (lockedType !== type) {
        throw new Error(
          "Property type changed before the operation completed.",
        );
      }
      if (isBlocksPropertyType(lockedType)) {
        throw new Error(
          "Property type changed before the operation completed.",
        );
      }
      if (isComputedPropertyType(lockedType)) {
        throw new Error("Computed properties cannot be edited.");
      }
      const isNaturalKey = lockedDatabase.naturalKeyPropertyId === propertyId;
      if (isNaturalKey) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(valueJson);
        } catch {
          parsed = null;
        }
        if (typeof parsed !== "string" || !parsed.trim()) {
          throw new Error(
            "A database natural key must remain a non-empty string.",
          );
        }
        const [existingNaturalKeyClaim] = await tx
          .select({
            keyValueJson: schema.contentDatabaseItemKeyClaims.keyValueJson,
          })
          .from(schema.contentDatabaseItemKeyClaims)
          .where(
            and(
              eq(schema.contentDatabaseItemKeyClaims.databaseId, database.id),
              eq(schema.contentDatabaseItemKeyClaims.propertyId, propertyId),
              eq(schema.contentDatabaseItemKeyClaims.documentId, documentId),
            ),
          )
          .limit(1);
        if (
          existingNaturalKeyClaim &&
          existingNaturalKeyClaim.keyValueJson !== valueJson
        ) {
          throw new Error(
            "A claimed database natural key cannot be changed. Create a new row instead.",
          );
        }
      }
      const [conflictingClaim] = await tx
        .select({ id: schema.contentDatabaseItemKeyClaims.id })
        .from(schema.contentDatabaseItemKeyClaims)
        .where(
          and(
            eq(schema.contentDatabaseItemKeyClaims.databaseId, database.id),
            eq(schema.contentDatabaseItemKeyClaims.propertyId, propertyId),
            eq(schema.contentDatabaseItemKeyClaims.keyValueJson, valueJson),
            ne(schema.contentDatabaseItemKeyClaims.documentId, documentId),
          ),
        )
        .limit(1);
      if (conflictingClaim) {
        throw new Error(
          "This value is already claimed as another row's stable key.",
        );
      }
      const [existing] = await tx
        .select({ id: schema.documentPropertyValues.id })
        .from(schema.documentPropertyValues)
        .where(
          and(
            eq(schema.documentPropertyValues.documentId, documentId),
            eq(schema.documentPropertyValues.propertyId, propertyId),
          ),
        );
      if (existing) {
        await tx
          .update(schema.documentPropertyValues)
          .set({ valueJson, updatedAt: now })
          .where(eq(schema.documentPropertyValues.id, existing.id));
      } else {
        await tx.insert(schema.documentPropertyValues).values({
          id: nanoid(),
          ownerEmail: database.ownerEmail,
          documentId,
          propertyId,
          valueJson,
          createdAt: now,
          updatedAt: now,
        });
      }
      if (isNaturalKey) {
        await tx
          .insert(schema.contentDatabaseItemKeyClaims)
          .values({
            id: nanoid(),
            ownerEmail: database.ownerEmail,
            orgId: database.orgId,
            databaseId: database.id,
            propertyId,
            keyValueJson: valueJson,
            itemId: membership.id,
            documentId,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
        const [claim] = await tx
          .select({
            itemId: schema.contentDatabaseItemKeyClaims.itemId,
            documentId: schema.contentDatabaseItemKeyClaims.documentId,
          })
          .from(schema.contentDatabaseItemKeyClaims)
          .where(
            and(
              eq(schema.contentDatabaseItemKeyClaims.databaseId, database.id),
              eq(schema.contentDatabaseItemKeyClaims.propertyId, propertyId),
              eq(schema.contentDatabaseItemKeyClaims.keyValueJson, valueJson),
            ),
          );
        if (
          !claim ||
          claim.itemId !== membership.id ||
          claim.documentId !== documentId
        ) {
          throw new Error(
            "This natural key is already claimed by another database row.",
          );
        }
      }
      await tx
        .delete(schema.contentDatabaseItemKeyClaims)
        .where(
          and(
            eq(schema.contentDatabaseItemKeyClaims.databaseId, database.id),
            eq(schema.contentDatabaseItemKeyClaims.propertyId, propertyId),
            eq(schema.contentDatabaseItemKeyClaims.documentId, documentId),
            ne(schema.contentDatabaseItemKeyClaims.keyValueJson, valueJson),
          ),
        );
    });

    return {
      documentId,
      databaseId: database.id,
      properties:
        (await listPropertiesForDatabaseDocuments(database.id, [document])).get(
          documentId,
        ) ?? [],
    };
  },
});
