import { defineEventHandler, createError } from "h3";
import { eq } from "drizzle-orm";
import { getDb } from "../../../db/index.js";
import { schema } from "../../../db/index.js";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const db = getDb();

  const [doc] = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, id));

  if (!doc) {
    throw createError({ statusCode: 404, statusMessage: "Document not found" });
  }

  return {
    id: doc.id,
    parentId: doc.parentId,
    title: doc.title,
    content: doc.content,
    icon: doc.icon,
    position: doc.position,
    isFavorite: Boolean(doc.isFavorite),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
});
