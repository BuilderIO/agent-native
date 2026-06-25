import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  listPropertiesForDocument,
  resolvePropertyDatabaseForDocument,
} from "./_property-utils.js";

export default defineAction({
  description:
    "Reorder a property definition within its database by moving it before or after another property. Used for reordering Blocks fields on the page.",
  schema: z.object({
    documentId: z.string().describe("Document ID used to scope access"),
    propertyId: z.string().describe("Property definition ID to move"),
    targetPropertyId: z.string().describe("Property to position relative to"),
    position: z
      .enum(["before", "after"])
      .default("before")
      .describe("Place the moved property before or after the target"),
  }),
  run: async ({ documentId, propertyId, targetPropertyId, position }) => {
    const access = await assertAccess("document", documentId, "editor");
    const document = access.resource;
    const db = getDb();
    const database = await resolvePropertyDatabaseForDocument(document);
    if (!database) throw new Error("Document is not part of a database.");

    const definitions = await db
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.databaseId, database.id))
      .orderBy(asc(schema.documentPropertyDefinitions.position));

    const ids = definitions.map((definition) => definition.id);
    if (!ids.includes(propertyId)) {
      throw new Error(`Property "${propertyId}" not found`);
    }
    if (!ids.includes(targetPropertyId)) {
      throw new Error(`Property "${targetPropertyId}" not found`);
    }
    if (propertyId === targetPropertyId) {
      return {
        documentId,
        databaseId: database.id,
        properties: await listPropertiesForDocument(document),
      };
    }

    // Rebuild the order with the moved property re-inserted relative to target.
    const remaining = ids.filter((id) => id !== propertyId);
    const targetIndex = remaining.indexOf(targetPropertyId);
    const insertAt = position === "after" ? targetIndex + 1 : targetIndex;
    remaining.splice(insertAt, 0, propertyId);

    const now = new Date().toISOString();
    for (let index = 0; index < remaining.length; index += 1) {
      await db
        .update(schema.documentPropertyDefinitions)
        .set({ position: index, updatedAt: now })
        .where(
          and(
            eq(schema.documentPropertyDefinitions.id, remaining[index]),
            eq(schema.documentPropertyDefinitions.databaseId, database.id),
          ),
        );
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      documentId,
      databaseId: database.id,
      properties: await listPropertiesForDocument(document),
    };
  },
});
