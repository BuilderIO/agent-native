import { defineEventHandler, createError } from "h3";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db/index.js";
import { schema } from "../../../../db/index.js";
import { getEventOwnerEmail } from "../../../../lib/documents.js";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const ownerEmail = await getEventOwnerEmail(event);
  const db = getDb();

  const [existing] = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, id),
        eq(schema.documents.ownerEmail, ownerEmail),
      ),
    );

  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: "Document not found" });
  }

  const versions = await db
    .select()
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.documentId, id),
        eq(schema.documentVersions.ownerEmail, ownerEmail),
      ),
    )
    .orderBy(desc(schema.documentVersions.createdAt));

  return {
    versions: versions.map((v) => ({
      id: v.id,
      documentId: v.documentId,
      title: v.title,
      content: v.content,
      createdAt: v.createdAt,
    })),
  };
});
