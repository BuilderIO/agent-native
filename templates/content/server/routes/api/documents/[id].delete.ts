import { defineEventHandler, createError } from "h3";
import { eq } from "drizzle-orm";
import { getDb } from "../../../db/index.js";
import { schema } from "../../../db/index.js";

async function deleteRecursive(
  db: ReturnType<typeof getDb>,
  id: string,
): Promise<void> {
  // Find children
  const children = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(eq(schema.documents.parentId, id));

  // Recursively delete children
  for (const child of children) {
    await deleteRecursive(db, child.id);
  }

  // Delete versions and document
  await db
    .delete(schema.documentVersions)
    .where(eq(schema.documentVersions.documentId, id));
  await db.delete(schema.documents).where(eq(schema.documents.id, id));
}

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const db = getDb();

  const [existing] = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, id));

  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: "Document not found" });
  }

  await deleteRecursive(db, id);

  return { success: true };
});
