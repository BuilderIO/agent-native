import { defineEventHandler, createError } from "h3";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../../../db/index.js";
import { schema } from "../../../../db/index.js";
import { parseDocumentFavorite } from "../../../../lib/documents.js";
import { readBody } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const body = await readBody(event);
  const access = await assertAccess("document", id, "editor");
  const ownerEmail = access.resource.ownerEmail as string;
  const db = getDb();

  const existing = access.resource;

  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: "Document not found" });
  }

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  if (body.parentId !== undefined) {
    if (body.parentId) {
      const parentAccess = await assertAccess(
        "document",
        body.parentId,
        "editor",
      );
      if (parentAccess.resource.ownerEmail !== ownerEmail) {
        throw createError({
          statusCode: 400,
          statusMessage: "Parent document must belong to the same owner",
        });
      }
    }
    updates.parentId = body.parentId;
  }

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
          ? and(
              eq(schema.documents.ownerEmail, ownerEmail),
              eq(schema.documents.parentId, parentId),
            )
          : and(
              eq(schema.documents.ownerEmail, ownerEmail),
              sql`parent_id IS NULL`,
            ),
      );
    updates.position = (maxPos[0]?.max ?? -1) + 1;
  }

  await db
    .update(schema.documents)
    .set(updates)
    .where(
      and(
        eq(schema.documents.id, id),
        eq(schema.documents.ownerEmail, ownerEmail),
      ),
    );

  const [doc] = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, id),
        eq(schema.documents.ownerEmail, ownerEmail),
      ),
    );

  return {
    id: doc.id,
    parentId: doc.parentId,
    title: doc.title,
    content: doc.content,
    icon: doc.icon,
    position: doc.position,
    isFavorite: parseDocumentFavorite(doc.isFavorite),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
});
