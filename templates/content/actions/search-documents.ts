import { defineAction } from "@agent-native/core";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/documents.js";
import { z } from "zod";

export default defineAction({
  description: "Search documents by title and content.",
  schema: z.object({
    query: z.string().describe("Search text"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const query = args.query;

    const ownerEmail = getCurrentOwnerEmail();
    const db = getDb();
    const pattern = `%${query}%`;

    const docs = await db
      .select({
        id: schema.documents.id,
        parentId: schema.documents.parentId,
        title: schema.documents.title,
        icon: schema.documents.icon,
        content: schema.documents.content,
        updatedAt: schema.documents.updatedAt,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.ownerEmail, ownerEmail),
          sql`${schema.documents.title} LIKE ${pattern} OR ${schema.documents.content} LIKE ${pattern}`,
        ),
      )
      .orderBy(sql`${schema.documents.updatedAt} DESC`);

    if (docs.length === 0) {
      console.log(`No documents matching "${query}".`);
      return { documents: [] };
    }

    console.log(`Found ${docs.length} document(s) matching "${query}"`);
    return { documents: docs };
  },
});
