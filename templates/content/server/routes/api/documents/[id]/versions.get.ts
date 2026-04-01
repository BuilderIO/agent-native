import { defineEventHandler, createError } from "h3";
import { eq, desc } from "drizzle-orm";
import { getDb } from "../../../../db/index.js";
import { schema } from "../../../../db/index.js";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const db = getDb();

  const [existing] = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(eq(schema.documents.id, id));

  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: "Document not found" });
  }

  const versions = await db
    .select()
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.documentId, id))
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
