import { z } from "zod";

export function contentOutputContract<T>(schema: z.ZodType): z.ZodType<T> {
  return schema as z.ZodType<T>;
}

const count = z.number().int().nonnegative();

export const contentDiscoveryPaginationSchema = z.looseObject({
  offset: count,
  limit: count,
  totalItems: count,
  returnedItems: count,
  hasMore: z.boolean(),
  nextOffset: count.nullable(),
});

export const contentWriteTargetSchema = z.strictObject({
  authorityScope: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("personal"), id: z.string().min(1) }),
    z.strictObject({ kind: z.literal("organization"), id: z.string().min(1) }),
  ]),
  spaceId: z.string().min(1),
  databaseId: z.string().min(1),
  databaseDocumentId: z.string().min(1),
});

const contentReceiptTargetSchema = z.looseObject({
  spaceId: z.string(),
  databaseId: z.string(),
  databaseDocumentId: z.string(),
});

const propertyGenerationsSchema = z.record(z.string(), z.number());
const propertyChangeIdsSchema = z.record(z.string(), z.number().nullable());
const propertyListSchema = z.array(z.unknown());

export const contentDatabaseMutationContractSchema = z.looseObject({
  target: contentWriteTargetSchema,
  schemaRevision: z.string().min(1),
  naturalKeyPropertyId: z.string().nullable(),
  properties: z.array(
    z.looseObject({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      writable: z.boolean(),
    }),
  ),
});

const contentDatabaseRowSchema = z.looseObject({
  id: z.string(),
  databaseId: z.string(),
  document: z.looseObject({ id: z.string(), title: z.string() }),
  position: z.number(),
  properties: propertyListSchema,
  rowRevision: z.string().optional(),
});

export const getContentDatabaseOutputSchema = z.union([
  z.looseObject({
    available: z.literal(false),
    reason: z.enum(["deleted", "not_found"]),
    databaseId: z.string(),
    message: z.string(),
  }),
  z.looseObject({
    database: z.looseObject({
      id: z.string(),
      documentId: z.string(),
      title: z.string(),
    }),
    properties: propertyListSchema,
    items: z.array(contentDatabaseRowSchema),
    pagination: z
      .looseObject({
        offset: count,
        limit: count,
        totalItems: count,
        returnedItems: count,
        hasMore: z.boolean(),
      })
      .optional(),
    mutationContract: contentDatabaseMutationContractSchema.optional(),
  }),
]);

export const listContentDatabasesOutputSchema = z.looseObject({
  databases: z.array(
    z.looseObject({
      databaseId: z.string(),
      documentId: z.string(),
      spaceId: z.string().nullable(),
      title: z.string(),
    }),
  ),
  pagination: contentDiscoveryPaginationSchema,
  systemCollections: z
    .array(
      z.looseObject({
        databaseId: z.string(),
        documentId: z.string(),
        spaceId: z.string().nullable(),
        title: z.string(),
        systemRole: z.string(),
      }),
    )
    .optional(),
});

export const searchContentDatabaseRowsOutputSchema = z.looseObject({
  databaseId: z.string(),
  databaseDocumentId: z.string(),
  rowCreation: z
    .looseObject({
      target: contentWriteTargetSchema,
      schemaRevision: z.string().min(1),
    })
    .nullable(),
  rows: z.array(
    z.looseObject({
      documentId: z.string(),
      title: z.string(),
      icon: z.string().nullable(),
    }),
  ),
  pagination: contentDiscoveryPaginationSchema,
});

export const searchDocumentsOutputSchema = z.looseObject({
  documents: z.array(
    z.looseObject({
      id: z.string(),
      parentId: z.string().nullable(),
      parentTitle: z.string().nullable(),
      title: z.string(),
      snippet: z.string(),
      updatedAt: z.string(),
      matchedBy: z.enum(["words", "meaning", "both"]).optional(),
    }),
  ),
  pagination: contentDiscoveryPaginationSchema,
});

export const getDocumentOutputSchema = z.looseObject({
  id: z.string(),
  spaceId: z.string().nullable(),
  parentId: z.string().nullable(),
  title: z.string(),
  content: z.string(),
  revision: z.string(),
  baseRevision: z.string(),
  bodyRevision: z.number().int(),
  contentHash: z.string(),
  description: z.string(),
  canEdit: z.boolean(),
  properties: propertyListSchema,
  propertyGenerations: propertyGenerationsSchema,
  propertyChangeIds: propertyChangeIdsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const idempotencySchema = z.looseObject({
  key: z.string(),
  result: z.enum(["applied", "replayed"]),
  payloadDigest: z.string(),
});

export const contentReceiptReplaySchema = z.strictObject({
  readback: z.literal("historical"),
  recordedAt: z.string(),
  freshRead: z.strictObject({
    action: z.literal("get-content-database"),
    databaseId: z.string().min(1),
  }),
});

export const patchDatabaseItemsOutputSchema = z.looseObject({
  receipt: z.looseObject({
    receiptId: z.string(),
    target: contentReceiptTargetSchema,
    schemaRevision: z.string(),
    idempotency: idempotencySchema,
    replay: contentReceiptReplaySchema.optional(),
    counts: z.looseObject({
      requested: count,
      updated: count,
      unchanged: count,
    }),
    rows: z.array(
      z.looseObject({
        itemId: z.string(),
        documentId: z.string(),
        outcome: z.enum(["updated", "unchanged"]),
        revisions: z.looseObject({ before: z.string(), after: z.string() }),
        readback: z.looseObject({
          verified: z.literal(true),
          propertyValues: z.record(z.string(), z.unknown()),
        }),
      }),
    ),
  }),
});
