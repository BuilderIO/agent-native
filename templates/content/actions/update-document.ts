import { defineAction } from "@agent-native/core";
import { eq, desc } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { parseDocumentFavorite } from "../server/lib/documents.js";
import { writeAppState } from "@agent-native/core/application-state";

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
  parameters: {
    id: { type: "string", description: "Document ID (required)" },
    title: { type: "string", description: "New title" },
    content: { type: "string", description: "New markdown content" },
    icon: { type: "string", description: "New emoji icon" },
    isFavorite: { type: "string", description: "Favorite status (true/false)" },
  },
  run: async (args) => {
    const id = args.id;
    if (!id) throw new Error("--id is required");

    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, id));

    if (!existing) throw new Error(`Document "${id}" not found`);

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

    // Snapshot the current state before applying content/title changes
    if (args.title !== undefined || content !== undefined) {
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

    if (args.title !== undefined) updates.title = args.title;
    if (content !== undefined) updates.content = content;
    if (args.icon !== undefined) updates.icon = args.icon;
    if (args.isFavorite !== undefined)
      updates.isFavorite = args.isFavorite === "true" ? 1 : 0;

    await db
      .update(schema.documents)
      .set(updates)
      .where(eq(schema.documents.id, id));

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
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  },
});
