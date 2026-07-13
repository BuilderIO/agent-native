import {
  getSession,
  readBody,
  runWithRequestContext,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
import { defineEventHandler, createError } from "h3";

import {
  documentsPositionScope,
  withPositionLock,
} from "../../../../../actions/_position-utils.js";
import { getDb } from "../../../../db/index.js";
import { schema } from "../../../../db/index.js";
import {
  parseDocumentFavorite,
  parseDocumentHideFromSearch,
} from "../../../../lib/documents.js";

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
        throw createError({
          statusCode: 400,
          statusMessage: "A document cannot be moved under one of its children",
        });
      }
      queue.push(child.id);
    }
  }
}

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const body = await readBody(event);
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }

  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    async () => {
      const access = await assertAccess("document", id, "editor");
      const ownerEmail = access.resource.ownerEmail as string;
      const db = getDb();

      const existing = access.resource;

      if (!existing) {
        throw createError({
          statusCode: 404,
          statusMessage: "Document not found",
        });
      }

      const updates: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };

      if (body.parentId !== undefined) {
        if (body.parentId) {
          const parentAccess = await assertAccess(
            "document",
            body.parentId,
            "editor",
          );
          if (parentAccess.resource.ownerEmail !== ownerEmail) {
            throw createError({
              statusCode: 400,
              statusMessage: "Parent document must belong to the same owner",
            });
          }
          await assertParentIsNotDescendant({
            db,
            ownerEmail,
            id,
            parentId: body.parentId,
          });
        }
        updates.parentId = body.parentId;
      }

      const applyUpdate = () =>
        db
          .update(schema.documents)
          .set(updates)
          .where(
            and(
              eq(schema.documents.id, id),
              eq(schema.documents.ownerEmail, ownerEmail),
            ),
          );

      if (body.position !== undefined) {
        updates.position = body.position;
        await applyUpdate();
      } else if (body.parentId !== undefined) {
        // Auto-assign position at end of new parent's children. Reads
        // MAX(position) then writes MAX+1 — serialize the read through the
        // write so a concurrent move/create/add targeting the same parent
        // can't read the same MAX (see actions/_position-utils.ts).
        const parentId = body.parentId;
        await withPositionLock(
          documentsPositionScope(ownerEmail, parentId),
          async () => {
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
            await applyUpdate();
          },
        );
      } else {
        await applyUpdate();
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

      return {
        id: doc.id,
        parentId: doc.parentId,
        title: doc.title,
        content: doc.content,
        icon: doc.icon,
        position: doc.position,
        isFavorite: parseDocumentFavorite(doc.isFavorite),
        hideFromSearch: parseDocumentHideFromSearch(doc.hideFromSearch),
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
    },
  );
});
