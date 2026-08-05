import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { lockContentDatabaseMutation } from "./_content-database-mutation-lock.js";
import {
  listPropertiesForDocument,
  resolvePropertyDatabaseForDocument,
} from "./_property-utils.js";

export default defineAction({
  description:
    "Reorder a property definition within its database by moving it before or after another property. Used for reordering Blocks fields on the page.",
  schema: z.object({
    documentId: z.string().describe("Document ID used to scope access"),
    databaseId: z
      .string()
      .optional()
      .describe(
        "Database ID that owns the properties; omit only for context-free entry points",
      ),
    propertyId: z.string().describe("Property definition ID to move"),
    targetPropertyId: z.string().describe("Property to position relative to"),
    position: z
      .enum(["before", "after"])
      .default("before")
      .describe("Place the moved property before or after the target"),
  }),
  run: async ({
    documentId,
    databaseId,
    propertyId,
    targetPropertyId,
    position,
  }) => {
    const access = await assertAccess("document", documentId, "editor");
    const document = access.resource;
    const db = getDb();
    const database = await resolvePropertyDatabaseForDocument(
      document,
      databaseId,
      "editor",
    );
    if (!database) throw new Error("Document is not part of a database.");

    const now = new Date().toISOString();
    await db.transaction(async (tx) => {
      await lockContentDatabaseMutation(
        tx as unknown as ReturnType<typeof getDb>,
        database.id,
      );
      const definitions = await tx
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
      const definitionById = new Map(
        definitions.map((definition) => [definition.id, definition]),
      );
      if (
        definitionById.get(propertyId)?.systemRole ||
        definitionById.get(targetPropertyId)?.systemRole
      ) {
        throw new Error("System properties cannot be reordered.");
      }
      if (propertyId === targetPropertyId) return;

      const remaining = ids.filter((id) => id !== propertyId);
      const targetIndex = remaining.indexOf(targetPropertyId);
      const insertAt = position === "after" ? targetIndex + 1 : targetIndex;
      remaining.splice(insertAt, 0, propertyId);

      for (let index = 0; index < remaining.length; index += 1) {
        await tx
          .update(schema.documentPropertyDefinitions)
          .set({ position: index, updatedAt: now })
          .where(
            and(
              eq(schema.documentPropertyDefinitions.id, remaining[index]),
              eq(schema.documentPropertyDefinitions.databaseId, database.id),
            ),
          );
      }
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      documentId,
      databaseId: database.id,
      properties: await listPropertiesForDocument(document, database.id),
    };
  },
});
