import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  listPropertiesForDocument,
  resolvePropertyDatabaseForDocument,
} from "./_property-utils.js";

export default defineAction({
  description:
    "Delete a Notion-style property definition and its stored document values.",
  schema: z.object({
    documentId: z.string().describe("Document ID used to scope access"),
    propertyId: z.string().describe("Property definition ID to delete"),
  }),
  run: async ({ documentId, propertyId }) => {
    const access = await assertAccess("document", documentId, "editor");
    const document = access.resource;
    const db = getDb();
    const database = await resolvePropertyDatabaseForDocument(document);
    if (!database) throw new Error("Document is not part of a database.");

    const [definition] = await db
      .select({ id: schema.documentPropertyDefinitions.id })
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

    await db
      .delete(schema.documentPropertyValues)
      .where(eq(schema.documentPropertyValues.propertyId, propertyId));
    await db
      .delete(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.id, propertyId));

    // Free any source field that was mapped to this property so it returns to
    // the "From source" picker immediately, instead of staying orphaned until
    // the next source refresh reconciles it.
    const mappedFields = await db
      .select({
        id: schema.contentDatabaseSourceFields.id,
        sourceFieldKey: schema.contentDatabaseSourceFields.sourceFieldKey,
      })
      .from(schema.contentDatabaseSourceFields)
      .where(eq(schema.contentDatabaseSourceFields.propertyId, propertyId));
    if (mappedFields.length > 0) {
      const now = new Date().toISOString();
      for (const mapped of mappedFields) {
        await db
          .update(schema.contentDatabaseSourceFields)
          .set({
            propertyId: null,
            localFieldKey: mapped.sourceFieldKey,
            mappingType: "property",
            updatedAt: now,
          })
          .where(eq(schema.contentDatabaseSourceFields.id, mapped.id));
      }
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      documentId,
      databaseId: database.id,
      properties: await listPropertiesForDocument(document),
    };
  },
});
