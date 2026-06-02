import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  isComputedPropertyType,
  type DocumentPropertyType,
} from "../shared/properties.js";
import {
  listPropertiesForDocument,
  nanoid,
  normalizedValueJson,
  resolvePropertyDatabaseForDocument,
} from "./_property-utils.js";

export default defineAction({
  description: "Set a Notion-style property value on a document.",
  schema: z.object({
    documentId: z.string().describe("Document ID (required)"),
    propertyId: z.string().describe("Property definition ID"),
    value: z.unknown().describe("Value for the property type"),
  }),
  run: async ({ documentId, propertyId, value }) => {
    const access = await assertAccess("document", documentId, "editor");
    const document = access.resource;
    const db = getDb();
    const database = await resolvePropertyDatabaseForDocument(document);
    if (!database) throw new Error("Document is not part of a database.");

    const [definition] = await db
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(
        and(
          eq(schema.documentPropertyDefinitions.id, propertyId),
          eq(
            schema.documentPropertyDefinitions.ownerEmail,
            document.ownerEmail,
          ),
          eq(schema.documentPropertyDefinitions.databaseId, database.id),
        ),
      );
    if (!definition) throw new Error(`Property "${propertyId}" not found`);

    const type = definition.type as DocumentPropertyType;
    if (isComputedPropertyType(type)) {
      throw new Error("Computed properties cannot be edited.");
    }

    const now = new Date().toISOString();
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
        ownerEmail: document.ownerEmail,
        documentId,
        propertyId,
        valueJson,
        createdAt: now,
        updatedAt: now,
      });
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      documentId,
      databaseId: database.id,
      properties: await listPropertiesForDocument(document),
    };
  },
});
