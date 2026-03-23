import { defineEventHandler, readBody, createError } from "h3";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../../db/index.js";
import { schema } from "../../../../db/index.js";

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

  if (body.parentId !== undefined) updates.parentId = body.parentId;

  if (body.position !== undefined) {
    updates.position = body.position;
  } else if (body.parentId !== undefined) {
    // Auto-assign position at end of new parent's children
    const parentId = body.parentId;
    const maxPos = await db
      .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
      .from(schema.documents)
      .where(
        parentId
          ? eq(schema.documents.parentId, parentId)
          : sql`parent_id IS NULL`,
      );
    updates.position = (maxPos[0]?.max ?? -1) + 1;
  }

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
