import { defineEventHandler, readBody, createError } from "h3";
import { eq, desc } from "drizzle-orm";
import { getDb } from "../../../db/index.js";
import { schema } from "../../../db/index.js";
import { parseDocumentFavorite } from "../../../lib/documents.js";

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

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

  // Snapshot the current state before applying content/title changes
  if (body.title !== undefined || body.content !== undefined) {
    const [latestVersion] = await db
      .select({ createdAt: schema.documentVersions.createdAt })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, id))
      .orderBy(desc(schema.documentVersions.createdAt))
      .limit(1);

    const shouldSnapshot =
      !latestVersion ||
      Date.now() - new Date(latestVersion.createdAt).getTime() >
        SNAPSHOT_INTERVAL_MS;

    if (shouldSnapshot) {
      await db.insert(schema.documentVersions).values({
        id: nanoid(),
        documentId: id,
        title: existing.title,
        content: existing.content,
        createdAt: new Date().toISOString(),
      });
    }
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
    isFavorite: parseDocumentFavorite(doc.isFavorite),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
});
