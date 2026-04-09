import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

async function deleteRecursive(
  db: ReturnType<typeof getDb>,
  id: string,
): Promise<string[]> {
  const children = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(eq(schema.documents.parentId, id));

  const deleted: string[] = [];
  for (const child of children) {
    deleted.push(...(await deleteRecursive(db, child.id)));
  }

  // Delete sync links, versions, then document
  await db
    .delete(schema.documentSyncLinks)
    .where(eq(schema.documentSyncLinks.documentId, id));
  await db
    .delete(schema.documentVersions)
    .where(eq(schema.documentVersions.documentId, id));
  await db.delete(schema.documents).where(eq(schema.documents.id, id));
  deleted.push(id);

  return deleted;
}

export default defineAction({
  description: "Delete a document and all its children recursively.",
  schema: z.object({
    id: z.string().optional().describe("Document ID (required)"),
  }),
  run: async (args) => {
    const id = args.id;
    if (!id) throw new Error("--id is required");

    const db = getDb();
    const [existing] = await db
      .select({ id: schema.documents.id, title: schema.documents.title })
      .from(schema.documents)
      .where(eq(schema.documents.id, id));

    if (!existing) throw new Error(`Document "${id}" not found`);

    const deleted = await deleteRecursive(db, id);
    const childCount = deleted.length - 1;

    // Trigger UI refresh
    await writeAppState("refresh-signal", { ts: Date.now() });

    const msg =
      `Deleted "${existing.title}" (${id})` +
      (childCount > 0 ? ` and ${childCount} child document(s)` : "");
    console.log(msg);

    return { success: true, deleted: deleted.length };
  },
});
