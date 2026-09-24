import { ActionContractError, defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { ForbiddenError } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireDocumentRequestActor } from "../server/lib/document-attribution.js";
import { assertDocumentMutationAccess } from "./_document-mutation-access.js";
import {
  lockDatabasesForTrash,
  trashDocumentSubtree,
} from "./delete-document.js";

const ROLLBACK_WINDOW_MS = 5 * 60 * 1000;

export function assertSlashRollbackEligible(args: {
  actor: string;
  child: {
    id: string;
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
    content: string;
    parentId: string | null;
    trashedAt: string | null;
  };
  parentId: string;
  parentContent: string;
  ownerBlockId?: string | null;
  hasChildren: boolean;
  hasDatabaseItems: boolean;
  now: number;
}) {
  if (args.child.createdBy?.toLowerCase() !== args.actor) {
    throw new ForbiddenError("Only the creator can roll back this new page.");
  }
  const createdAt = Date.parse(args.child.createdAt);
  if (
    args.child.parentId !== args.parentId ||
    args.child.trashedAt ||
    !Number.isFinite(createdAt) ||
    args.now < createdAt ||
    args.now - createdAt > ROLLBACK_WINDOW_MS ||
    args.child.updatedAt !== args.child.createdAt ||
    args.child.content !== "" ||
    args.hasChildren ||
    args.hasDatabaseItems ||
    args.parentContent.includes(args.child.id)
  ) {
    throw new ActionContractError(
      "The new page changed or is already linked; it cannot be rolled back.",
      { errorCode: "SLASH_ROLLBACK_NOT_EMPTY", statusCode: 409 },
    );
  }
  if (args.ownerBlockId && args.parentContent.includes(args.ownerBlockId)) {
    throw new ActionContractError(
      "The new collection is already linked; it cannot be rolled back.",
      { errorCode: "SLASH_ROLLBACK_LINKED", statusCode: 409 },
    );
  }
}

export default defineAction({
  description:
    "Move an unchanged page or collection created by this caller's failed slash insertion to Trash; requires editor access to its parent.",
  schema: z
    .object({
      id: z.string().min(1).describe("New page or collection document ID"),
      parentId: z.string().min(1).describe("Page where slash creation began"),
    })
    .strict(),
  run: async ({ id, parentId }, context) => {
    const actor = requireDocumentRequestActor(context);
    const parentAccess = await assertDocumentMutationAccess(
      parentId,
      "editor",
      "parentId",
    );
    const ownerEmail = parentAccess.resource.ownerEmail as string;
    const db = getDb();
    const deletedIds = await db.transaction(async (transaction) => {
      const tx = transaction as unknown as ReturnType<typeof getDb>;
      const [parent] = await tx
        .select({ content: schema.documents.content })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.id, parentId),
            eq(schema.documents.ownerEmail, ownerEmail),
            isNull(schema.documents.trashedAt),
          ),
        )
        .for("update");
      const [child] = await tx
        .select({
          createdBy: schema.documents.createdBy,
          createdAt: schema.documents.createdAt,
          updatedAt: schema.documents.updatedAt,
          content: schema.documents.content,
          parentId: schema.documents.parentId,
          trashedAt: schema.documents.trashedAt,
        })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.id, id),
            eq(schema.documents.ownerEmail, ownerEmail),
          ),
        )
        .for("update");
      if (!parent) {
        throw new ActionContractError(
          "The new page is unavailable for rollback.",
          {
            errorCode: "SLASH_ROLLBACK_UNAVAILABLE",
            statusCode: 409,
          },
        );
      }
      if (!child) return [];
      const [database] = await tx
        .select({
          id: schema.contentDatabases.id,
          ownerBlockId: schema.contentDatabases.ownerBlockId,
          systemRole: schema.contentDatabases.systemRole,
        })
        .from(schema.contentDatabases)
        .where(
          and(
            eq(schema.contentDatabases.documentId, id),
            eq(schema.contentDatabases.ownerEmail, ownerEmail),
          ),
        )
        .limit(1);
      const [childDocument] = await tx
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.parentId, id),
            eq(schema.documents.ownerEmail, ownerEmail),
            isNull(schema.documents.trashedAt),
          ),
        )
        .limit(1);
      const [databaseItem] = database
        ? await tx
            .select({ id: schema.contentDatabaseItems.id })
            .from(schema.contentDatabaseItems)
            .where(
              and(
                eq(schema.contentDatabaseItems.databaseId, database.id),
                eq(schema.contentDatabaseItems.ownerEmail, ownerEmail),
              ),
            )
            .limit(1)
        : [];
      assertSlashRollbackEligible({
        actor,
        child: { ...child, id },
        parentId,
        parentContent: parent.content,
        ownerBlockId: database?.ownerBlockId,
        hasChildren: !!childDocument,
        hasDatabaseItems: !!databaseItem || !!database?.systemRole,
        now: Date.now(),
      });
      const lockedDatabaseIds = await lockDatabasesForTrash(tx, id, ownerEmail);
      return trashDocumentSubtree(
        tx,
        id,
        ownerEmail,
        undefined,
        lockedDatabaseIds,
      );
    });
    if (deletedIds.length > 0) {
      await writeAppState("refresh-signal", { ts: Date.now() });
    }
    return {
      success: true,
      id,
      disposition: deletedIds.length > 0 ? "trashed" : "absent",
      deletedIds,
    };
  },
});
