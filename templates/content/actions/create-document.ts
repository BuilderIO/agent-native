import { defineAction } from "@agent-native/core";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { parseDocumentFavorite } from "../server/lib/documents.js";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
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

export default defineAction({
  description: "Create a new document.",
  schema: z.object({
    id: z
      .string()
      .optional()
      .describe("Pre-generated document ID (for optimistic UI)"),
    title: z.string().describe("Document title"),
    content: z.string().optional().describe("Markdown content"),
    parentId: z.string().nullish().describe("Parent document ID for nesting"),
    icon: z.string().optional().describe("Emoji icon"),
  }),
  run: async (args) => {
    const title = args.title;

    let content = args.content || "";
    // Strip leading H1 that duplicates the title
    if (title && content) {
      const h1Match = content.match(/^#\s+(.+?)(\r?\n|$)/);
      if (
        h1Match &&
        h1Match[1].trim().toLowerCase() === title.trim().toLowerCase()
      ) {
        content = content.slice(h1Match[0].length).trimStart();
      }
    }

    const parentId = args.parentId || null;
    const icon = args.icon || null;
    const ownerEmail = getRequestUserEmail() ?? "local@localhost";
    const orgId = getRequestOrgId() ?? null;
    const db = getDb();

    // Get max position among siblings
    const maxPos = await db
      .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
      .from(schema.documents)
      .where(
        parentId
          ? and(
              eq(schema.documents.ownerEmail, ownerEmail),
              eq(schema.documents.parentId, parentId),
            )
          : and(
              eq(schema.documents.ownerEmail, ownerEmail),
              sql`parent_id IS NULL`,
            ),
      );

    const position = (maxPos[0]?.max ?? -1) + 1;
    const now = new Date().toISOString();
    const id = args.id || nanoid();

    await db.insert(schema.documents).values({
      id,
      ownerEmail,
      orgId,
      parentId,
      title,
      content,
      icon,
      position,
      isFavorite: 0,
      createdAt: now,
      updatedAt: now,
      // visibility defaults to 'private' via schema default
    });

    const [doc] = await db
      .select()
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, id),
          eq(schema.documents.ownerEmail, ownerEmail),
        ),
      );

    // Trigger UI refresh
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Created document "${title}" (${id})`);

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
