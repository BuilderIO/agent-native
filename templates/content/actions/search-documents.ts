import { defineAction } from "@agent-native/core";
import { and, sql } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { accessFilter } from "@agent-native/core/sharing";
import { z } from "zod";

function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}

export default defineAction({
  description: "Search documents by title and content.",
  schema: z.object({
    query: z.string().describe("Search text"),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const query = args.query;

    const db = getDb();
    const pattern = `%${escapeLike(query)}%`;

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
          accessFilter(schema.documents, schema.documentShares),
          sql`(${schema.documents.title} LIKE ${pattern} ESCAPE '\\' OR ${schema.documents.content} LIKE ${pattern} ESCAPE '\\')`,
        ),
      )
      .orderBy(sql`${schema.documents.updatedAt} DESC`)
      .limit(args.limit);

    if (docs.length === 0) {
      console.log(`No documents matching "${query}".`);
      return { documents: [] };
    }

    console.log(`Found ${docs.length} document(s) matching "${query}"`);
    return { documents: docs };
  },
});
