import { fail } from "@agent-native/core/action";
import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  not,
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

const contentTrashOperatorSchema = z.enum(["is", "isNot"]).default("is");

const contentTrashValueConditionSchema = z
  .object({
    field: z.enum([
      "spaceId",
      "parentId",
      "createdBy",
      "updatedBy",
      "deletedBy",
    ]),
    operator: contentTrashOperatorSchema,
    values: z.array(z.string().trim().min(1).max(320)).min(1).max(100),
  })
  .strict();

const contentTrashKindConditionSchema = z
  .object({
    field: z.literal("kind"),
    operator: contentTrashOperatorSchema,
    values: z
      .array(z.enum(["page", "database"]))
      .min(1)
      .max(2),
  })
  .strict();

const contentTrashDateConditionSchema = z
  .object({
    field: z.literal("deletedAt"),
    from: contentTrashDateSchema.optional(),
    to: contentTrashDateSchema.optional(),
  })
  .strict()
  .refine((value) => value.from || value.to, {
    message: "deletedAt needs from or to",
  });

const contentTrashConditionSchema = z.union([
  contentTrashValueConditionSchema,
  contentTrashKindConditionSchema,
  contentTrashDateConditionSchema,
]);

const contentTrashMatchModeSchema = z.enum(["and", "or"]);

export const contentTrashWhereSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      fail("Invalid Trash where JSON", {
        errorCode: "invalid_where",
        statusCode: 400,
      });
    }
  },
  z
    .object({
      mode: contentTrashMatchModeSchema,
      items: z
        .array(
          z.union([
            contentTrashConditionSchema,
            z
              .object({
                mode: contentTrashMatchModeSchema,
                conditions: z.array(contentTrashConditionSchema).min(1).max(50),
              })
              .strict(),
          ]),
        )
        .max(50),
    })
    .strict(),
);

export type ContentTrashWhere = z.infer<typeof contentTrashWhereSchema>;
type ContentTrashCondition = z.infer<typeof contentTrashConditionSchema>;

export interface ContentTrashWhereColumns {
  spaceId: SQLWrapper;
  parentId: SQLWrapper;
  createdBy: SQLWrapper;
  updatedBy: SQLWrapper;
  deletedBy: SQLWrapper;
  databaseId: SQLWrapper;
  deletedAt: SQLWrapper;
}

function combine(mode: "and" | "or", predicates: Array<SQL | undefined>) {
  const present = predicates.filter((predicate) => predicate !== undefined);
  if (!present.length) return undefined;
  return mode === "or" ? or(...present) : and(...present);
}

function contentTrashConditionPredicate(
  condition: ContentTrashCondition,
  columns: ContentTrashWhereColumns,
): SQL | undefined {
  if (condition.field === "deletedAt") {
    return combine("and", [
      condition.from ? gte(columns.deletedAt, condition.from) : undefined,
      condition.to ? lte(columns.deletedAt, condition.to) : undefined,
    ]);
  }
  if (condition.field === "kind") {
    const kinds = new Set(condition.values);
    const matched =
      kinds.size === 2
        ? sql`true`
        : kinds.has("page")
          ? isNull(columns.databaseId)
          : isNotNull(columns.databaseId);
    return condition.operator === "isNot" ? not(matched) : matched;
  }
  const caseInsensitive =
    condition.field === "createdBy" || condition.field === "updatedBy";
  const column = caseInsensitive
    ? sql`lower(${columns[condition.field]})`
    : columns[condition.field];
  const listed = inArray(column, [
    ...new Set(
      caseInsensitive
        ? condition.values.map((value) => value.toLowerCase())
        : condition.values,
    ),
  ]);
  return condition.operator === "isNot"
    ? or(isNull(column), not(listed))
    : listed;
}

export function contentTrashWherePredicate(
  where: ContentTrashWhere | undefined,
  columns: ContentTrashWhereColumns,
): SQL | undefined {
  if (!where) return undefined;
  return combine(
    where.mode,
    where.items.map((item) =>
      "conditions" in item
        ? combine(
            item.mode,
            item.conditions.map((condition) =>
              contentTrashConditionPredicate(condition, columns),
            ),
          )
        : contentTrashConditionPredicate(item, columns),
    ),
  );
}

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
  where: contentTrashWhereSchema.optional(),
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
