import { ActionContractError } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { blocksFieldId } from "../shared/blocks-field-identity.js";
import { reconcileDocuments } from "./_content-files.js";
import { resolveContentSpaceTarget } from "./_content-space-target.js";
import { assertDocumentMutationAccess } from "./_document-mutation-access.js";
import {
  assertSubtreeCanChangeSpace,
  loadPageSubtree,
  type PageSubtreeDocument,
} from "./_page-subtree.js";
import {
  documentsPositionScope,
  nextAppendPosition,
  withPositionLock,
} from "./_position-utils.js";

type ContentDb = ReturnType<typeof getDb>;
type ContentTx = Parameters<Parameters<ContentDb["transaction"]>[0]>[0];

function groups<T>(values: T[], size = 90): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

function contractError(message: string, errorCode: string, statusCode = 409) {
  return new ActionContractError(message, { errorCode, statusCode });
}

async function rekeyPrimaryBlocksFields(args: {
  tx: ContentTx;
  documentIds: string[];
  fromPropertyId: string | null;
  toPropertyId: string | null;
  ownerEmail: string;
  now: string;
}) {
  const { tx, fromPropertyId, toPropertyId } = args;
  if (!fromPropertyId || !toPropertyId || fromPropertyId === toPropertyId) {
    return;
  }
  for (const documentId of args.documentIds) {
    const fromFieldId = blocksFieldId(documentId, fromPropertyId);
    const toFieldId = blocksFieldId(documentId, toPropertyId);
    const [field] = await tx
      .select()
      .from(schema.documentBlockFields)
      .where(eq(schema.documentBlockFields.id, fromFieldId));
    if (!field) continue;
    await tx
      .delete(schema.documentBlocks)
      .where(eq(schema.documentBlocks.fieldId, toFieldId));
    await tx
      .delete(schema.documentBlockFields)
      .where(eq(schema.documentBlockFields.id, toFieldId));
    await tx.insert(schema.documentBlockFields).values({
      ...field,
      id: toFieldId,
      propertyId: toPropertyId,
      ownerEmail: args.ownerEmail,
      updatedAt: args.now,
    });
    await tx
      .update(schema.documentBlocks)
      .set({ fieldId: toFieldId, ownerEmail: args.ownerEmail })
      .where(eq(schema.documentBlocks.fieldId, fromFieldId));
    await tx
      .delete(schema.documentBlockFields)
      .where(eq(schema.documentBlockFields.id, fromFieldId));
  }
}

export async function movePageToSpace(args: {
  root: PageSubtreeDocument;
  spaceId: string;
  parentId: string | null;
}) {
  const { root, spaceId, parentId } = args;
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  const db = getDb();

  await resolveContentSpaceTarget({
    db,
    userEmail,
    spaceId,
    requiredRole: "contributor",
  });
  const spaces = await db
    .select()
    .from(schema.contentSpaces)
    .where(
      inArray(
        schema.contentSpaces.id,
        [spaceId, root.spaceId].filter((id): id is string => Boolean(id)),
      ),
    );
  const destination = spaces.find((space) => space.id === spaceId);
  if (!destination || destination.archivedAt) {
    throw contractError("Content space not found", "SPACE_NOT_FOUND", 404);
  }
  if (destination.kind === "source_backed") {
    throw contractError(
      "Pages can't be moved into a local folder workspace.",
      "SPACE_SOURCE_BACKED",
    );
  }

  const subtree = await loadPageSubtree(db, root, { includeTrashed: true });
  for (const document of subtree.slice(1)) {
    await assertDocumentMutationAccess(document.id, "editor", "id");
  }
  await assertSubtreeCanChangeSpace(db, subtree);
  const ids = subtree.map((document) => document.id);

  let orgId = destination.orgId ?? null;
  let visibility: "private" | "org" | "public" = orgId ? "org" : "private";
  let parentShares: Array<typeof schema.documentShares.$inferSelect> = [];
  if (parentId) {
    const parent = (
      await assertDocumentMutationAccess(parentId, "editor", "parentId")
    ).resource as PageSubtreeDocument;
    if (parent.spaceId !== spaceId) {
      throw contractError(
        "Parent document must be in the destination Content space",
        "PARENT_SPACE_MISMATCH",
      );
    }
    if (parent.ownerEmail !== userEmail) {
      throw contractError(
        "In another workspace, a page can only be moved to the top level or under a page you own.",
        "PARENT_OWNER_MISMATCH",
      );
    }
    if (parent.trashedAt) {
      throw contractError("Parent document is in Trash", "PARENT_TRASHED");
    }
    orgId = parent.orgId ?? null;
    visibility = parent.visibility as typeof visibility;
    parentShares = await db
      .select()
      .from(schema.documentShares)
      .where(eq(schema.documentShares.resourceId, parentId));
  }

  const filesDatabases = await db
    .select()
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.systemRole, "files"),
        inArray(
          schema.contentDatabases.spaceId,
          spaces.map((space) => space.id),
        ),
      ),
    );
  const fromFiles = filesDatabases.find(
    (database) => database.spaceId === root.spaceId,
  );
  const toFiles = filesDatabases.find(
    (database) => database.spaceId === spaceId,
  );
  if (!toFiles) {
    throw contractError(
      "Content space has no Files database",
      "SPACE_FILES_MISSING",
    );
  }
  const fromFilesPropertyIds = fromFiles
    ? (
        await db
          .select({ id: schema.documentPropertyDefinitions.id })
          .from(schema.documentPropertyDefinitions)
          .where(
            eq(schema.documentPropertyDefinitions.databaseId, fromFiles.id),
          )
      ).map((property) => property.id)
    : [];

  if (fromFilesPropertyIds.length > 0) {
    for (const idGroup of groups(ids)) {
      const [extraContent] = await db
        .select({ id: schema.documentBlockFieldContents.id })
        .from(schema.documentBlockFieldContents)
        .where(
          and(
            inArray(schema.documentBlockFieldContents.documentId, idGroup),
            inArray(
              schema.documentBlockFieldContents.propertyId,
              fromFilesPropertyIds,
            ),
            ne(schema.documentBlockFieldContents.content, ""),
          ),
        )
        .limit(1);
      if (extraContent) {
        throw contractError(
          "Pages with content in this workspace's extra Files fields can't move to another workspace yet.",
          "PAGE_HAS_FILES_BLOCKS_FIELDS",
        );
      }
    }
  }

  const now = new Date().toISOString();
  await withPositionLock(
    documentsPositionScope(userEmail, parentId),
    async () => {
      const [maxPosition] = await db
        .select({ max: sql<unknown>`COALESCE(MAX(position), -1)` })
        .from(schema.documents)
        .where(
          parentId
            ? and(
                eq(schema.documents.ownerEmail, userEmail),
                eq(schema.documents.parentId, parentId),
              )
            : and(
                eq(schema.documents.ownerEmail, userEmail),
                eq(schema.documents.visibility, visibility),
                orgId
                  ? eq(schema.documents.orgId, orgId)
                  : isNull(schema.documents.orgId),
                isNull(schema.documents.parentId),
              ),
        );

      await db.transaction(async (tx) => {
        const idSet = new Set(ids);
        for (const idGroup of groups(ids)) {
          const children: Array<{ id: string }> = await tx
            .select({ id: schema.documents.id })
            .from(schema.documents)
            .where(
              or(
                inArray(schema.documents.parentId, idGroup),
                inArray(schema.documents.trashParentId, idGroup),
              ),
            );
          if (children.some((child) => !idSet.has(child.id))) {
            throw contractError(
              "This page changed while it was being moved. Try again.",
              "PAGE_SUBTREE_CHANGED",
            );
          }
        }
        for (const idGroup of groups(ids)) {
          await tx
            .update(schema.documents)
            .set({ spaceId, ownerEmail: userEmail, orgId, visibility })
            .where(inArray(schema.documents.id, idGroup));
          await tx
            .delete(schema.documentShares)
            .where(inArray(schema.documentShares.resourceId, idGroup));
          for (const table of [
            schema.documentComments,
            schema.documentVersions,
            schema.documentBlockFields,
          ]) {
            await tx
              .update(table)
              .set({ ownerEmail: userEmail })
              .where(inArray(table.documentId, idGroup));
          }
          if (fromFilesPropertyIds.length > 0) {
            await tx
              .delete(schema.documentPropertyValues)
              .where(
                and(
                  inArray(schema.documentPropertyValues.documentId, idGroup),
                  inArray(
                    schema.documentPropertyValues.propertyId,
                    fromFilesPropertyIds,
                  ),
                ),
              );
          }
          await tx
            .update(schema.documentPropertyValues)
            .set({ ownerEmail: userEmail })
            .where(inArray(schema.documentPropertyValues.documentId, idGroup));
        }
        if (parentShares.length > 0) {
          await tx.insert(schema.documentShares).values(
            ids.flatMap((id) =>
              parentShares.map((share) => ({
                id: nanoid(),
                resourceId: id,
                principalType: share.principalType,
                principalId: share.principalId,
                role: share.role,
                createdBy: userEmail,
                createdAt: now,
              })),
            ),
          );
        }
        await tx
          .update(schema.documents)
          .set({
            parentId,
            position: nextAppendPosition(maxPosition?.max),
            updatedAt: now,
          })
          .where(eq(schema.documents.id, root.id));
        await rekeyPrimaryBlocksFields({
          tx,
          documentIds: ids,
          fromPropertyId: fromFiles?.primaryBlocksPropertyId ?? null,
          toPropertyId: toFiles.primaryBlocksPropertyId ?? null,
          ownerEmail: userEmail,
          now,
        });
        const moved: PageSubtreeDocument[] = [];
        for (const idGroup of groups(ids)) {
          moved.push(
            ...(await tx
              .select()
              .from(schema.documents)
              .where(inArray(schema.documents.id, idGroup))),
          );
        }
        await reconcileDocuments({
          db: tx as unknown as ContentDb,
          documents: moved,
          filesDatabases: fromFiles ? [fromFiles, toFiles] : [toFiles],
          now,
        });
      });
    },
  );

  const [document] = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, root.id));
  return { document, movedCount: ids.length };
}
