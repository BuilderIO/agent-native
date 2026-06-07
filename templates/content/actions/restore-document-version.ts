import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  parseDocumentFavorite,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

export default defineAction({
  description:
    "Restore a document to a saved version, snapshotting the current state first.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID"),
    versionId: z.string().optional().describe("Version ID"),
  }),
  run: async (args) => {
    if (!args.documentId) throw new Error("--documentId is required");
    if (!args.versionId) throw new Error("--versionId is required");

    const access = await assertAccess("document", args.documentId, "editor");
    const doc = access.resource;
    const ownerEmail = doc.ownerEmail as string;
    const db = getDb();

    const [version] = await db
      .select()
      .from(schema.documentVersions)
      .where(
        and(
          eq(schema.documentVersions.id, args.versionId),
          eq(schema.documentVersions.documentId, args.documentId),
          eq(schema.documentVersions.ownerEmail, ownerEmail),
        ),
      )
      .limit(1);

    if (!version) throw new Error(`Version not found: ${args.versionId}`);

    const now = new Date().toISOString();
    await db.insert(schema.documentVersions).values({
      id: nanoid(),
      ownerEmail,
      documentId: args.documentId,
      title: doc.title,
      content: doc.content,
      createdAt: now,
    });

    await db
      .update(schema.documents)
      .set({
        title: version.title,
        content: version.content,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.documents.id, args.documentId),
          eq(schema.documents.ownerEmail, ownerEmail),
        ),
      );

    const [updated] = await db
      .select()
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, args.documentId),
          eq(schema.documents.ownerEmail, ownerEmail),
        ),
      )
      .limit(1);

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      id: updated.id,
      parentId: updated.parentId,
      title: updated.title,
      content: updated.content,
      icon: updated.icon,
      position: updated.position,
      isFavorite: parseDocumentFavorite(updated.isFavorite),
      hideFromSearch: parseDocumentHideFromSearch(updated.hideFromSearch),
      visibility: updated.visibility,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  },
});
