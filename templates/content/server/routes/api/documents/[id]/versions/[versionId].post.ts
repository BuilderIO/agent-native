import { defineEventHandler, createError } from "h3";
import { eq, and } from "drizzle-orm";
import { getDb } from "../../../../../db/index.js";
import { schema } from "../../../../../db/index.js";
import { parseDocumentFavorite } from "../../../../../lib/documents.js";
import { assertAccess } from "@agent-native/core/sharing";

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

export default defineEventHandler(async (event) => {
  const { id, versionId } = event.context.params!;
  const access = await assertAccess("document", id, "editor").catch(() => null);
  if (!access) {
    throw createError({ statusCode: 404, statusMessage: "Document not found" });
  }
  const ownerEmail = access.resource.ownerEmail as string;
  const db = getDb();

  const doc = access.resource;

  const [version] = await db
    .select()
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.id, versionId),
        eq(schema.documentVersions.documentId, id),
        eq(schema.documentVersions.ownerEmail, ownerEmail),
      ),
    );

  if (!version) {
    throw createError({ statusCode: 404, statusMessage: "Version not found" });
  }

  // Snapshot current state before restoring so the restore is non-destructive
  const now = new Date().toISOString();
  await db.insert(schema.documentVersions).values({
    id: nanoid(),
    ownerEmail,
    documentId: id,
    title: doc.title,
    content: doc.content,
    createdAt: now,
  });

  // Restore the document to the selected version
  await db
    .update(schema.documents)
    .set({
      title: version.title,
      content: version.content,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.documents.id, id),
        eq(schema.documents.ownerEmail, ownerEmail),
      ),
    );

  const [updated] = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, id),
        eq(schema.documents.ownerEmail, ownerEmail),
      ),
    );

  return {
    id: updated.id,
    parentId: updated.parentId,
    title: updated.title,
    content: updated.content,
    icon: updated.icon,
    position: updated.position,
    isFavorite: parseDocumentFavorite(updated.isFavorite),
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };
});
