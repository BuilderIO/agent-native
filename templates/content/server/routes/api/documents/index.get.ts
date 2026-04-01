import { defineEventHandler } from "h3";
import { asc } from "drizzle-orm";
import { getDb } from "../../../db/index.js";
import { schema } from "../../../db/index.js";
import { parseDocumentFavorite } from "../../../lib/documents.js";

export default defineEventHandler(async () => {
  const db = getDb();
  const documents = await db
    .select()
    .from(schema.documents)
    .orderBy(asc(schema.documents.position));

  return {
    documents: documents.map((d) => ({
      id: d.id,
      parentId: d.parentId,
      title: d.title,
      content: d.content,
      icon: d.icon,
      position: d.position,
      isFavorite: parseDocumentFavorite(d.isFavorite),
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    })),
  };
});
