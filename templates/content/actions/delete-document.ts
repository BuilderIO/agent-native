import { defineAction } from "@agent-native/core";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

async function deleteRecursive(
  db: ReturnType<typeof getDb>,
  id: string,
  ownerEmail: string,
): Promise<string[]> {
  const children = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.parentId, id),
        eq(schema.documents.ownerEmail, ownerEmail),
      ),
    );

  const deleted: string[] = [];
  for (const child of children) {
    deleted.push(...(await deleteRecursive(db, child.id, ownerEmail)));
  }

  // Delete sync links, versions, shares, then document
  await db
    .delete(schema.documentSyncLinks)
    .where(
      and(
        eq(schema.documentSyncLinks.documentId, id),
        eq(schema.documentSyncLinks.ownerEmail, ownerEmail),
      ),
    );
  await db
    .delete(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.documentId, id),
        eq(schema.documentVersions.ownerEmail, ownerEmail),
      ),
    );
  await db
    .delete(schema.documentShares)
    .where(eq(schema.documentShares.resourceId, id));
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

    const access = await assertAccess("document", id, "admin");
    const existing = access.resource;

    const db = getDb();
    const deleted = await deleteRecursive(
      db,
      id,
      existing.ownerEmail as string,
    );
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
