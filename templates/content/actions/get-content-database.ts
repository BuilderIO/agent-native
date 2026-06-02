import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

export default defineAction({
  description:
    "Get a content database table, including its property schema and item pages.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ databaseId, documentId }) => {
    const db = getDb();
    let resolvedDatabaseId = databaseId;

    if (!resolvedDatabaseId && documentId) {
      const [database] = await db
        .select()
        .from(schema.contentDatabases)
        .where(eq(schema.contentDatabases.documentId, documentId));
      resolvedDatabaseId = database?.id;
    }

    if (!resolvedDatabaseId) {
      throw new Error("Either databaseId or documentId is required.");
    }

    const [database] = await db
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, resolvedDatabaseId));
    if (!database)
      throw new Error(`Database "${resolvedDatabaseId}" not found`);

    const access = await resolveAccess("document", database.documentId);
    if (!access) throw new Error(`Database "${resolvedDatabaseId}" not found`);

    return getContentDatabaseResponse(resolvedDatabaseId);
  },
});
