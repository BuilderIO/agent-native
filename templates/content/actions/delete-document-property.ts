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

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      documentId,
      databaseId: database.id,
      properties: await listPropertiesForDocument(document),
    };
  },
});
