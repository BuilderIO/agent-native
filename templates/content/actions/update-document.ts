import { defineAction } from "@agent-native/core";
import { and, eq, desc } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { parseDocumentFavorite } from "../server/lib/documents.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export default defineAction({
  description:
    "Update an existing document's title, content, icon, or favorite status.",
  schema: z.object({
    id: z.string().optional().describe("Document ID (required)"),
    title: z.string().optional().describe("New title"),
    content: z.string().optional().describe("New markdown content"),
    icon: z.string().optional().describe("New emoji icon"),
    isFavorite: z.coerce
      .boolean()
      .optional()
      .describe("Favorite status (true/false)"),
  }),
  run: async (args) => {
    const id = args.id;
    if (!id) throw new Error("--id is required");

    const access = await assertAccess("document", id, "editor");
    const existing = access.resource;
    const ownerEmail = existing.ownerEmail as string;

    const db = getDb();

    // Strip leading H1 that duplicates the title
    let content = args.content;
    if (content !== undefined) {
      const titleToCheck = args.title || existing.title;
      if (titleToCheck) {
        const h1Match = content.match(/^#\s+(.+?)(\r?\n|$)/);
        if (
          h1Match &&
          h1Match[1].trim().toLowerCase() === titleToCheck.trim().toLowerCase()
        ) {
          content = content.slice(h1Match[0].length).trimStart();
        }
      }
    }

    // Detect actual changes — a no-op call (e.g. the editor echoing back the
    // same content after a Notion pull) must NOT bump updated_at, otherwise
    // the next sync sees a phantom local change and reports a conflict.
    const titleChanged =
      args.title !== undefined && args.title !== existing.title;
    const contentChanged =
      content !== undefined && content !== existing.content;
    const iconChanged = args.icon !== undefined && args.icon !== existing.icon;
    const favoriteChanged =
      args.isFavorite !== undefined &&
      (args.isFavorite ? 1 : 0) !== (existing.isFavorite ?? 0);
    const anyChange =
      titleChanged || contentChanged || iconChanged || favoriteChanged;

    // Snapshot the current state before applying content/title changes.
    // Versions are scoped to the document owner, not the caller — an editor
    // share collaborator shouldn't create a phantom version row under their
    // own email.
    if (titleChanged || contentChanged) {
      const [latestVersion] = await db
        .select({ createdAt: schema.documentVersions.createdAt })
        .from(schema.documentVersions)
        .where(
          and(
            eq(schema.documentVersions.documentId, id),
            eq(schema.documentVersions.ownerEmail, ownerEmail),
          ),
        )
        .orderBy(desc(schema.documentVersions.createdAt))
        .limit(1);

      const shouldSnapshot =
        !latestVersion ||
        Date.now() - new Date(latestVersion.createdAt).getTime() >
          SNAPSHOT_INTERVAL_MS;

      if (shouldSnapshot) {
        await db.insert(schema.documentVersions).values({
          id: nanoid(),
          ownerEmail,
          documentId: id,
          title: existing.title,
          content: existing.content,
          createdAt: new Date().toISOString(),
        });
      }
    }

    if (anyChange) {
      const updates: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };

      if (titleChanged) updates.title = args.title;
      if (contentChanged) updates.content = content;
      if (iconChanged) updates.icon = args.icon;
      if (favoriteChanged) updates.isFavorite = args.isFavorite ? 1 : 0;

      await db
        .update(schema.documents)
        .set(updates)
        .where(eq(schema.documents.id, id));
    }

    const [doc] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, id));

    // Trigger UI refresh
    await writeAppState("refresh-signal", { ts: Date.now() });

    const updated: string[] = [];
    if (args.title) updated.push(`title="${args.title}"`);
    if (content !== undefined) updated.push("content");
    if (args.icon) updated.push(`icon="${args.icon}"`);
    if (updated.length > 0) {
      console.log(`Updated document ${id}: ${updated.join(", ")}`);
    }

    return {
      id: doc.id,
      parentId: doc.parentId,
      title: doc.title,
      content: doc.content,
      icon: doc.icon,
      position: doc.position,
      isFavorite: parseDocumentFavorite(doc.isFavorite),
      visibility: doc.visibility,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  },
});
