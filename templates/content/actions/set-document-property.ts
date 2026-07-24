import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
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
import { resolveContentDocumentAccess } from "./_content-document-access.js";
import {
  getDatabaseById,
  listPropertiesForDatabaseDocuments,
  nanoid,
  normalizedValueJson,
  writeBlockFieldContent,
  writePrimaryBlocksContent,
} from "./_property-utils.js";

export default defineAction({
  description: "Set a Notion-style property value on a document.",
  schema: z.object({
    documentId: z.string().describe("Document ID (required)"),
    databaseId: z.string().describe("Database ID that owns the property"),
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
    if (definition.databaseId !== databaseId) {
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
      const target = blocksStorageTarget(
        parsePropertyOptions(definition.optionsJson),
      );
      if (target === "document_body") {
        await writePrimaryBlocksContent({ documentId, content, now });
      } else {
        await writeBlockFieldContent({
          documentId,
          propertyId,
          ownerEmail: database.ownerEmail,
          content,
          now,
        });
      }
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
    const [existing] = await db
      .select({ id: schema.documentPropertyValues.id })
      .from(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.documentId, documentId),
          eq(schema.documentPropertyValues.propertyId, propertyId),
        ),
      );

    if (existing) {
      await db
        .update(schema.documentPropertyValues)
        .set({ valueJson, updatedAt: now })
        .where(eq(schema.documentPropertyValues.id, existing.id));
    } else {
      await db.insert(schema.documentPropertyValues).values({
        id: nanoid(),
        ownerEmail: database.ownerEmail,
        documentId,
        propertyId,
        valueJson,
        createdAt: now,
        updatedAt: now,
      });
    }

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
