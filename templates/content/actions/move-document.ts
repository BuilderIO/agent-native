import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess, type Visibility } from "@agent-native/core/sharing";
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

async function preflightBlockDatabaseOwnershipClearance({
  db,
  documentId,
  ownerEmail,
  parentId,
}: {
  db: ReturnType<typeof getDb>;
  documentId: string;
  ownerEmail: string;
  parentId: string | null;
}): Promise<string | null> {
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
    return null;
  }

  await assertAccess("document", database.ownerDocumentId, "editor");
  return database.id;
}

async function clearBlockDatabaseOwnership({
  db,
  databaseId,
  ownerEmail,
  updatedAt,
}: {
  db: Pick<ReturnType<typeof getDb>, "update">;
  databaseId: string;
  ownerEmail: string;
  updatedAt: string;
}) {
  await db
    .update(schema.contentDatabases)
    .set({
      ownerDocumentId: null,
      ownerBlockId: null,
      updatedAt,
    })
    .where(
      and(
        eq(schema.contentDatabases.id, databaseId),
        eq(schema.contentDatabases.ownerEmail, ownerEmail),
      ),
    );
}

function sameRootSection(
  left: { visibility: Visibility; orgId?: string | null },
  right: { visibility: Visibility; orgId?: string | null },
) {
  return left.visibility === right.visibility && left.orgId === right.orgId;
}

function rootSectionFilter(document: {
  visibility: Visibility;
  orgId?: string | null;
}) {
  return and(
    eq(schema.documents.visibility, document.visibility),
    document.orgId
      ? eq(schema.documents.orgId, document.orgId)
      : sql`${schema.documents.orgId} IS NULL`,
  );
}

async function resolveSiblingPositionsAfterMove({
  db,
  ownerEmail,
  id,
  parentId,
  rootSection,
  position,
}: {
  db: ReturnType<typeof getDb>;
  ownerEmail: string;
  id: string;
  parentId: string | null;
  rootSection: { visibility: Visibility; orgId?: string | null };
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
            rootSectionFilter(rootSection),
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
        if (!sameRootSection(parentAccess.resource, existing)) {
          throw new Error("Parent document must be in the same section");
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
    const blockDatabaseIdToDetach =
      args.parentId !== undefined
        ? await preflightBlockDatabaseOwnershipClearance({
            db,
            documentId: id,
            ownerEmail,
            parentId: args.parentId,
          })
        : null;
    const normalizedSiblingPositions =
      args.position !== undefined
        ? await resolveSiblingPositionsAfterMove({
            db,
            ownerEmail,
            id,
            parentId: targetParentId,
            rootSection: existing,
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
                rootSectionFilter(existing),
                sql`parent_id IS NULL`,
              ),
        );
      updates.position = (maxPos[0]?.max ?? -1) + 1;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(schema.documents)
        .set(updates)
        .where(
          and(
            eq(schema.documents.id, id),
            eq(schema.documents.ownerEmail, ownerEmail),
          ),
        );

      if (args.parentId !== undefined && blockDatabaseIdToDetach) {
        await clearBlockDatabaseOwnership({
          db: tx,
          databaseId: blockDatabaseIdToDetach,
          ownerEmail,
          updatedAt,
        });
      }

      if (normalizedSiblingPositions) {
        for (const document of normalizedSiblingPositions) {
          await tx
            .update(schema.documents)
            .set({ position: document.position })
            .where(
              and(
                eq(schema.documents.id, document.id),
                eq(schema.documents.ownerEmail, ownerEmail),
              ),
            );
        }
      }
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
