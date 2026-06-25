import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  parseDocumentFavorite,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import {
  isLocalDocumentId,
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

async function clearBlockDatabaseOwnershipAfterParentChange({
  db,
  documentId,
  ownerEmail,
  parentId,
  updatedAt,
}: {
  db: ReturnType<typeof getDb>;
  documentId: string;
  ownerEmail: string;
  parentId: string | null;
  updatedAt: string;
}) {
  const [database] = await db
    .select({
      id: schema.contentDatabases.id,
      ownerDocumentId: schema.contentDatabases.ownerDocumentId,
    })
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.documentId, documentId),
        eq(schema.contentDatabases.ownerEmail, ownerEmail),
      ),
    );

  if (!database?.ownerDocumentId || database.ownerDocumentId === parentId) {
    return;
  }

  await assertAccess("document", database.ownerDocumentId, "editor");

  await db
    .update(schema.contentDatabases)
    .set({
      ownerDocumentId: null,
      ownerBlockId: null,
      updatedAt,
    })
    .where(
      and(
        eq(schema.contentDatabases.id, database.id),
        eq(schema.contentDatabases.ownerEmail, ownerEmail),
      ),
    );
}

async function resolveSiblingPositionsAfterMove({
  db,
  ownerEmail,
  id,
  parentId,
  position,
}: {
  db: ReturnType<typeof getDb>;
  ownerEmail: string;
  id: string;
  parentId: string | null;
  position: number;
}) {
  const siblings = await db
    .select({
      id: schema.documents.id,
      position: schema.documents.position,
      title: schema.documents.title,
    })
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
  const siblingsWithoutActive = siblings
    .filter((document) => document.id !== id)
    .sort(
      (a, b) =>
        a.position - b.position ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
  const nextIndex = Math.max(
    0,
    Math.min(position, siblingsWithoutActive.length),
  );
  siblingsWithoutActive.splice(nextIndex, 0, {
    id,
    position: nextIndex,
    title: "",
  });
  return siblingsWithoutActive.map((document, index) => ({
    id: document.id,
    position: index,
  }));
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

    if ((await isContentLocalFileMode()) && isLocalDocumentId(id)) {
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

    const updatedAt = new Date().toISOString();
    const updates: Record<string, unknown> = {
      updatedAt,
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

    const targetParentId =
      args.parentId !== undefined ? args.parentId : existing.parentId;
    const normalizedSiblingPositions =
      args.position !== undefined
        ? await resolveSiblingPositionsAfterMove({
            db,
            ownerEmail,
            id,
            parentId: targetParentId,
            position: args.position,
          })
        : null;

    if (args.position !== undefined) {
      updates.position =
        normalizedSiblingPositions?.find((document) => document.id === id)
          ?.position ?? args.position;
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

    if (args.parentId !== undefined) {
      await clearBlockDatabaseOwnershipAfterParentChange({
        db,
        documentId: id,
        ownerEmail,
        parentId: args.parentId,
        updatedAt,
      });
    }

    if (normalizedSiblingPositions) {
      await Promise.all(
        normalizedSiblingPositions.map((document) =>
          db
            .update(schema.documents)
            .set({ position: document.position })
            .where(
              and(
                eq(schema.documents.id, document.id),
                eq(schema.documents.ownerEmail, ownerEmail),
              ),
            ),
        ),
      );
    }

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
