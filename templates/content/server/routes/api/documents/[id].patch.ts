import { defineEventHandler, readBody, createError } from "h3";
import { eq } from "drizzle-orm";
import { getDb } from "../../../db/index.js";
import { schema } from "../../../db/index.js";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const body = await readBody(event);
  const db = getDb();

  const [existing] = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, id));

  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: "Document not found" });
  }

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  if (body.title !== undefined) updates.title = body.title;
  if (body.content !== undefined) updates.content = body.content;
  if (body.icon !== undefined) updates.icon = body.icon;
  if (body.isFavorite !== undefined)
    updates.isFavorite = body.isFavorite ? 1 : 0;

  await db
    .update(schema.documents)
    .set(updates)
    .where(eq(schema.documents.id, id));

  const [doc] = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, id));

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
