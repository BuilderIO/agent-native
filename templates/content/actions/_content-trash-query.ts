import {
  and,
  eq,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { z } from "zod";

export const contentTrashDateSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString())
  .describe("ISO 8601 timestamp with a timezone offset.");

export const contentTrashFilterFields = {
  query: z.string().trim().max(200).optional(),
  kind: z.enum(["page", "database"]).optional(),
  parentId: z.string().max(200).optional(),
  actor: z.string().trim().max(320).optional(),
  createdBy: z.string().trim().max(320).optional(),
  updatedBy: z.string().trim().max(320).optional(),
  deletedFrom: contentTrashDateSchema.optional(),
  deletedTo: contentTrashDateSchema.optional(),
  spaceId: z.string().max(200).optional(),
  sort: z.enum(["name", "createdAt", "updatedAt", "deletedAt"]).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
};

export function validateContentTrashDateRange(
  value: { deletedFrom?: string; deletedTo?: string },
  context: z.RefinementCtx,
) {
  if (
    value.deletedFrom &&
    value.deletedTo &&
    value.deletedFrom > value.deletedTo
  ) {
    context.addIssue({
      code: "custom",
      path: ["deletedTo"],
      message: "deletedTo must be at or after deletedFrom",
    });
  }
}

export function contentTrashPredicates(
  documentTable: { parentId: SQLWrapper; trashedAt: SQLWrapper },
  databaseTable: {
    id: SQLWrapper;
    ownerDocumentId: SQLWrapper;
    deletedAt: SQLWrapper;
  },
  documentAdminAccess: SQLWrapper,
  documentViewerAccess: SQLWrapper,
  hostEditorAccess: SQLWrapper,
): { authority: SQL; deletedAt: SQL<string> } {
  const blockOwned = and(
    isNotNull(databaseTable.ownerDocumentId),
    eq(documentTable.parentId, databaseTable.ownerDocumentId),
  );
  return {
    deletedAt: sql<string>`coalesce(${documentTable.trashedAt}, ${databaseTable.deletedAt})`,
    authority: or(
      and(
        or(
          isNull(databaseTable.id),
          isNull(databaseTable.ownerDocumentId),
          ne(documentTable.parentId, databaseTable.ownerDocumentId),
        ),
        documentAdminAccess,
      ),
      and(
        isNotNull(databaseTable.id),
        blockOwned,
        documentViewerAccess,
        hostEditorAccess,
      ),
    )!,
  };
}
