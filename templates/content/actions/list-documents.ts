import { defineAction } from "@agent-native/core";
import { asc } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { parseDocumentFavorite } from "../server/lib/documents.js";
import { z } from "zod";

export default defineAction({
  description: "List all documents ordered by position.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const db = getDb();
    const documents = await db
      .select()
      .from(schema.documents)
      .orderBy(asc(schema.documents.position));

    const mapped = documents.map((d) => ({
      id: d.id,
      parentId: d.parentId,
      title: d.title,
      content: d.content,
      icon: d.icon,
      position: d.position,
      isFavorite: parseDocumentFavorite(d.isFavorite),
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));

    return { documents: mapped };
  },
});
