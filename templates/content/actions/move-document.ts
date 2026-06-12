import { defineAction } from "@agent-native/core";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  parseDocumentFavorite,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";
import {
  isContentLocalFileMode,
  moveLocalFileDocument,
} from "./_local-file-documents.js";

async function assertParentIsNotDescendant({
  db,
  ownerEmail,
  id,
  parentId,
}: {
  db: ReturnType<typeof getDb>;
  ownerEmail: string;
  id: string;
  parentId: string | null | undefined;
}) {
  if (!parentId) return;
  const queue = [id];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const children = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.ownerEmail, ownerEmail),
          eq(schema.documents.parentId, currentId),
        ),
      );

    for (const child of children) {
      if (child.id === parentId) {
        throw new Error("A document cannot be moved under one of its children");
      }
      queue.push(child.id);
    }
  }
}

export default defineAction({
  description: "Move a document to a parent and/or position in the page tree.",
  schema: z.object({
    id: z.string().optional().describe("Document ID (required)"),
    parentId: z
      .string()
      .nullable()
      .optional()
      .describe("New parent document ID, or null to move to the root"),
    position: z.coerce
      .number()
      .int()
      .optional()
      .describe("Sort position among siblings"),
  }),
  run: async (args) => {
    const id = args.id;
    if (!id) throw new Error("--id is required");
    if (args.parentId === undefined && args.position === undefined) {
      throw new Error("--parentId or --position is required");
    }
    if (args.parentId === id) {
      throw new Error("A document cannot be moved under itself");
    }

    if (await isContentLocalFileMode()) {
      const doc = await moveLocalFileDocument(id, args);
      await writeAppState("refresh-signal", { ts: Date.now() });
      return {
        ...doc,
        urlPath: `/page/${doc.id}`,
      };
    }

    const access = await assertAccess("document", id, "editor");
    const existing = access.resource;
    const ownerEmail = existing.ownerEmail as string;
    const db = getDb();

    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (args.parentId !== undefined) {
      if (args.parentId) {
        const parentAccess = await assertAccess(
          "document",
          args.parentId,
          "editor",
        );
        if (parentAccess.resource.ownerEmail !== ownerEmail) {
          throw new Error("Parent document must belong to the same owner");
        }
        await assertParentIsNotDescendant({
          db,
          ownerEmail,
          id,
          parentId: args.parentId,
        });
      }
      updates.parentId = args.parentId;
    }

    if (args.position !== undefined) {
      updates.position = args.position;
    } else if (args.parentId !== undefined) {
      const parentId = args.parentId;
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
      updates.position = (maxPos[0]?.max ?? -1) + 1;
    }

    await db
      .update(schema.documents)
      .set(updates)
      .where(
        and(
          eq(schema.documents.id, id),
          eq(schema.documents.ownerEmail, ownerEmail),
        ),
      );

    const [doc] = await db
      .select()
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, id),
          eq(schema.documents.ownerEmail, ownerEmail),
        ),
      );

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      id: doc.id,
      urlPath: `/page/${doc.id}`,
      parentId: doc.parentId,
      title: doc.title,
      content: doc.content,
      icon: doc.icon,
      position: doc.position,
      isFavorite: parseDocumentFavorite(doc.isFavorite),
      hideFromSearch: parseDocumentHideFromSearch(doc.hideFromSearch),
      visibility: doc.visibility,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  },
});
