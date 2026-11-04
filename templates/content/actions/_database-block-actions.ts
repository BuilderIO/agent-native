import { ActionContractError } from "@agent-native/core";
import type { DbExec } from "@agent-native/core/db";
import { assertAccess, currentAccess } from "@agent-native/core/sharing";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { lockLegacyBodyWrites } from "../server/lib/document-body-revision.js";
import { isLiveBodyWriterPage } from "../server/lib/live-body-writer.js";
import { assertNoNewlySharedVideoIds } from "../server/lib/video-block-ids.js";
import { CONTENT_LIVE_COPY_EDITS } from "../server/live-copy/binding.js";
import { drizzleOverExec } from "../server/live-copy/exec-db.js";
import {
  editContentLiveCopy,
  liveCopyBaseChanged,
  liveCopyWriteLeftPath,
  unrepresentableBodyError,
} from "../server/live-copy/write.js";
import {
  BLOCKS_FIELD_BLOCK_KINDS,
  BLOCKS_FIELD_OPERATION_CAPABILITIES,
  snapshotBlocksFieldMarkdown,
  type BlocksFieldBlockKind,
  type BlocksFieldIdentity,
} from "../shared/blocks-field-identity.js";
import type {
  ContentDatabaseBlock,
  ContentDatabaseBlockMutationReceipt,
  ContentDatabaseBlockMutationResult,
  ContentDatabaseBlocksReadResult,
} from "../shared/database-block-actions.js";
import {
  mutateBlocksFieldDocument,
  type BlockDocumentMutation,
} from "../shared/database-block-mutations.js";
import {
  blocksStorageTarget,
  isBlocksPropertyType,
  parsePropertyOptions,
  type BlocksStorageTarget,
  type DocumentPropertyType,
} from "../shared/properties.js";
import {
  BlocksFieldIdCollisionError,
  lockPrimaryBlocksFields,
  persistBlocksFieldIdentity,
  readBlocksFieldIdentity,
} from "./_blocks-field-identity.js";
import {
  lockContentDatabaseMutation,
  touchContentDatabase,
  withContentDatabaseMutationLock,
} from "./_content-database-mutation-lock.js";
import {
  assertSchema,
  databaseMutationTargetSchema,
  digest,
  isUniqueConstraintError,
  loadContext,
  revisionPropertyIds,
  rowSnapshot,
  type DatabaseMutationTarget,
  type MutationContext,
  type RowSnapshot,
} from "./_database-row-mutation.js";
import { assertSourceAllowsPageEdit } from "./_document-source.js";
import { nanoid } from "./_property-utils.js";

type Db = ReturnType<typeof getDb>;

const blockKindSchema = z.enum(BLOCKS_FIELD_BLOCK_KINDS);
const blockValueSchema = z.object({
  kind: blockKindSchema,
  nfm: z.string().max(1_000_000),
});
const placementSchema = z.discriminatedUnion("placement", [
  z.object({
    placement: z.enum(["start", "end"]),
    parentBlockId: z.string().min(1).nullable().optional(),
  }),
  z.object({
    placement: z.enum(["before", "after"]),
    anchorBlockId: z.string().min(1),
  }),
]);

export const databaseBlockTargetSchema = databaseMutationTargetSchema.extend({
  itemId: z.string().min(1).describe("Exact collection membership row ID"),
  rowDocumentId: z.string().min(1).describe("Exact row page ID"),
  propertyId: z.string().min(1).describe("Exact Blocks property ID"),
});

export const listDatabaseBlocksSchema = z.object({
  target: databaseBlockTargetSchema,
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

const mutationEnvelopeSchema = z.object({
  target: databaseBlockTargetSchema,
  expectedSchemaRevision: z.string().min(1),
  expectedRowRevision: z.string().min(1),
  expectedFieldRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1).max(200),
});

const mutateDatabaseBlockOperationSchema = z.discriminatedUnion("operation", [
  mutationEnvelopeSchema.extend({
    operation: z.literal("insert"),
    block: blockValueSchema,
    position: placementSchema,
  }),
  mutationEnvelopeSchema.extend({
    operation: z.literal("update"),
    blockId: z.string().min(1),
    block: blockValueSchema,
  }),
  mutationEnvelopeSchema.extend({
    operation: z.literal("upsert"),
    blockId: z.string().min(1),
    block: blockValueSchema,
    position: placementSchema.optional(),
  }),
  mutationEnvelopeSchema.extend({
    operation: z.literal("delete"),
    blockId: z.string().min(1),
  }),
  mutationEnvelopeSchema.extend({
    operation: z.literal("reorder"),
    blockId: z.string().min(1),
    position: placementSchema,
  }),
]);

type MutationInput = z.infer<typeof mutateDatabaseBlockOperationSchema>;

export const mutateDatabaseBlockSchema = z
  .object({
    ...mutationEnvelopeSchema.shape,
    operation: z.enum(["insert", "update", "upsert", "delete", "reorder"]),
    blockId: z.string().min(1).optional(),
    block: blockValueSchema.optional(),
    position: placementSchema.optional(),
  })
  .superRefine((value, context) => {
    const parsed = mutateDatabaseBlockOperationSchema.safeParse(value);
    if (parsed.success) return;
    for (const issue of parsed.error.issues) {
      context.addIssue({
        code: "custom",
        path: issue.path,
        message: issue.message,
      });
    }
  }) as z.ZodType<MutationInput>;

type BlockTarget = z.infer<typeof databaseBlockTargetSchema>;

interface LoadedField {
  context: MutationContext;
  row: RowSnapshot;
  markdown: string;
  identity: BlocksFieldIdentity;
  ownerEmail: string;
  storageTarget: BlocksStorageTarget;
  storageRowExists: boolean;
}

function contractError(
  errorCode: string,
  message: string,
  details?: Record<string, unknown>,
  statusCode = 409,
): never {
  throw new ActionContractError(message, { errorCode, details, statusCode });
}

function databaseTarget(target: BlockTarget): DatabaseMutationTarget {
  return {
    authorityScope: target.authorityScope,
    spaceId: target.spaceId,
    databaseId: target.databaseId,
    databaseDocumentId: target.databaseDocumentId,
  };
}

async function loadField(args: {
  target: BlockTarget;
  role: "viewer" | "editor";
  db?: Db;
  accessAlreadyResolved?: boolean;
}): Promise<LoadedField> {
  const db = args.db ?? getDb();
  const context = await loadContext(
    databaseTarget(args.target),
    args.role,
    db,
    args.accessAlreadyResolved,
  );
  if (!args.accessAlreadyResolved) {
    await assertAccess("document", args.target.rowDocumentId, args.role);
  }
  const row = await rowSnapshot(
    db,
    args.target.databaseId,
    args.target.itemId,
    args.target.rowDocumentId,
    revisionPropertyIds(context),
  );
  if (!row) {
    contractError(
      "ROW_NOT_FOUND",
      "Content database row not found.",
      {
        itemId: args.target.itemId,
        rowDocumentId: args.target.rowDocumentId,
      },
      404,
    );
  }
  const definition = context.definitions.find(
    (candidate) => candidate.id === args.target.propertyId,
  );
  if (
    !definition ||
    !isBlocksPropertyType(definition.type as DocumentPropertyType)
  ) {
    contractError(
      "BLOCKS_PROPERTY_NOT_FOUND",
      "The exact property is not a Blocks field in this database schema.",
      { propertyId: args.target.propertyId },
      400,
    );
  }
  if (definition.systemRole) {
    contractError(
      "BLOCKS_PROPERTY_UNSUPPORTED",
      "System Blocks properties cannot be mutated individually.",
      { propertyId: definition.id },
      400,
    );
  }
  if (
    args.role === "editor" &&
    context.sourceManagedPropertyIds.has(definition.id)
  ) {
    contractError(
      "SOURCE_MANAGED_PROPERTY",
      "Source-managed Blocks properties cannot be mutated locally.",
      { propertyId: definition.id },
      400,
    );
  }
  const storageTarget = blocksStorageTarget(
    parsePropertyOptions(definition.optionsJson),
  );
  if (args.role === "editor" && storageTarget === "document_body") {
    assertSourceAllowsPageEdit(row.document);
  }
  let markdown: string;
  let storageRowExists = true;
  if (storageTarget === "document_body") {
    markdown = row.document.content;
  } else {
    const [field] = await db
      .select({ content: schema.documentBlockFieldContents.content })
      .from(schema.documentBlockFieldContents)
      .where(
        and(
          eq(
            schema.documentBlockFieldContents.documentId,
            args.target.rowDocumentId,
          ),
          eq(
            schema.documentBlockFieldContents.propertyId,
            args.target.propertyId,
          ),
        ),
      );
    storageRowExists = field !== undefined;
    markdown = field?.content ?? "";
  }
  const identity = await readBlocksFieldIdentity({
    db,
    documentId: args.target.rowDocumentId,
    propertyId: args.target.propertyId,
    markdown,
  });
  return {
    context,
    row,
    markdown,
    identity,
    ownerEmail: context.database.ownerEmail,
    storageTarget,
    storageRowExists,
  };
}

function serializedBlocks(
  markdown: string,
  identity: BlocksFieldIdentity,
): ContentDatabaseBlock[] {
  const snapshots = snapshotBlocksFieldMarkdown(markdown);
  if (snapshots.length !== identity.blocks.length) {
    contractError(
      "BLOCK_IDENTITY_STALE",
      "Blocks identity does not match the current field body.",
    );
  }
  return identity.blocks.map((block, index) => {
    const snapshot = snapshots[index]!;
    if (snapshot.kind !== block.kind) {
      contractError(
        "BLOCK_IDENTITY_STALE",
        "Blocks identity kind does not match the current field body.",
      );
    }
    const kind = block.kind as BlocksFieldBlockKind;
    const supportedOperations = BLOCKS_FIELD_OPERATION_CAPABILITIES[kind];
    return {
      id: block.id,
      parentId: block.parentId,
      kind,
      index: block.position,
      addressable: block.addressable,
      value: { format: "nfm", nfm: snapshot.markdown },
      supportedOperations,
      degraded: false,
    };
  });
}

function encodeCursor(revision: number, offset: number) {
  return Buffer.from(JSON.stringify({ revision, offset })).toString(
    "base64url",
  );
}

function decodeCursor(cursor: string): { revision: number; offset: number } {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { revision?: unknown; offset?: unknown };
    if (
      !Number.isInteger(parsed.revision) ||
      !Number.isInteger(parsed.offset) ||
      (parsed.revision as number) < 0 ||
      (parsed.offset as number) < 0
    ) {
      throw new Error("invalid");
    }
    return {
      revision: parsed.revision as number,
      offset: parsed.offset as number,
    };
  } catch {
    contractError("INVALID_BLOCK_CURSOR", "Block cursor is invalid.", {}, 400);
  }
}

export async function listDatabaseBlocks(
  input: z.infer<typeof listDatabaseBlocksSchema>,
): Promise<ContentDatabaseBlocksReadResult> {
  const loaded = await loadField({ target: input.target, role: "viewer" });
  if (loaded.identity.identityStatus === "stale") {
    contractError(
      "BLOCK_IDENTITY_STALE",
      "The Blocks field changed without a matching identity revision.",
    );
  }
  const blocks = serializedBlocks(loaded.markdown, loaded.identity);
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  if (cursor && cursor.revision !== loaded.identity.revision) {
    contractError(
      "FIELD_REVISION_CONFLICT",
      "The Blocks field changed between list pages.",
      { expected: cursor.revision, actual: loaded.identity.revision },
    );
  }
  const offset = cursor?.offset ?? 0;
  if (offset > blocks.length) {
    contractError(
      "INVALID_BLOCK_CURSOR",
      "Block cursor is out of range.",
      {},
      400,
    );
  }
  const pageBlocks = blocks.slice(offset, offset + input.limit);
  const nextOffset = offset + pageBlocks.length;
  return {
    target: input.target,
    rowLink: {
      urlPath: `/page/${input.target.rowDocumentId}`,
      label: "Open database row",
    },
    schemaRevision: loaded.context.schemaRevision,
    rowRevision: loaded.row.revision,
    fieldRevision: loaded.identity.revision,
    identityStatus: loaded.identity.identityStatus,
    total: blocks.length,
    order: blocks.map((block) => block.id),
    blocks: pageBlocks,
    page: {
      offset,
      limit: input.limit,
      nextCursor:
        nextOffset < blocks.length
          ? encodeCursor(loaded.identity.revision, nextOffset)
          : null,
    },
  };
}

function mutationDigest(input: MutationInput) {
  return digest({ contract: "content-database-block-mutation-v1", input });
}

function actionMutation(
  input: MutationInput,
  identity: BlocksFieldIdentity,
  generatedInsertId: string,
): { mutation: BlockDocumentMutation; insertedBlockId?: string } {
  if (input.operation === "insert") {
    return {
      mutation: {
        operation: "insert",
        block: input.block,
        position: input.position,
      },
      insertedBlockId: generatedInsertId,
    };
  }
  if (input.operation === "upsert") {
    const live = identity.blocks.find((block) => block.id === input.blockId);
    if (live) {
      return {
        mutation: {
          operation: "upsert",
          blockId: input.blockId,
          block: input.block,
          position: input.position,
        },
      };
    }
    if (identity.tombstones.some((block) => block.id === input.blockId)) {
      contractError(
        "BLOCK_ID_TOMBSTONED",
        "Upsert cannot silently restore a tombstoned block ID.",
        { blockId: input.blockId },
      );
    }
    if (!input.position) {
      contractError(
        "BLOCK_POSITION_REQUIRED",
        "Upserting a new block requires an exact position.",
        { blockId: input.blockId },
        400,
      );
    }
    return {
      mutation: {
        operation: "insert",
        block: input.block,
        position: input.position,
      },
      insertedBlockId: input.blockId,
    };
  }
  return { mutation: input as BlockDocumentMutation };
}

function mapMutationFailure(error: unknown): never {
  if (error instanceof ActionContractError) throw error;
  const message = error instanceof Error ? error.message : String(error);
  const errorCode = message.includes("does not support")
    ? "BLOCK_OPERATION_UNSUPPORTED"
    : message.includes("Cross-parent") ||
        message.includes("outside the current parent")
      ? "CROSS_PARENT_REORDER_UNSUPPORTED"
      : message.includes("cannot change block kind")
        ? "BLOCK_KIND_MISMATCH"
        : message.includes("not found")
          ? "BLOCK_NOT_FOUND"
          : "INVALID_BLOCK_VALUE";
  contractError(
    errorCode,
    message,
    {},
    errorCode === "INVALID_BLOCK_VALUE" ? 400 : 409,
  );
}

async function writeMarkdown(
  db: Db,
  loaded: LoadedField,
  target: BlockTarget,
  markdown: string,
  now: string,
) {
  assertNoNewlySharedVideoIds(loaded.markdown, markdown);
  if (loaded.storageTarget === "document_body") {
    const legacy = await lockLegacyBodyWrites(db, [target.rowDocumentId], {
      operation: "mutate-content-database-block",
      content: markdown,
    });
    const updated = await db
      .update(schema.documents)
      .set({
        content: markdown,
        bodyRevision: legacy.bodyRevision(markdown),
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.documents.id, target.rowDocumentId),
          eq(schema.documents.content, loaded.markdown),
          isNull(schema.documents.trashedAt),
        ),
      )
      .returning({ id: schema.documents.id });
    if (updated.length === 0) {
      contractError(
        "FIELD_REVISION_CONFLICT",
        "The Blocks field changed before the mutation could commit.",
        { propertyId: target.propertyId },
      );
    }
    return;
  }
  await compareAndSwapAdditionalBlocksField({
    db,
    ownerEmail: loaded.ownerEmail,
    documentId: target.rowDocumentId,
    propertyId: target.propertyId,
    expectedContent: loaded.markdown,
    expectedExists: loaded.storageRowExists,
    content: markdown,
    now,
  });
}

export async function compareAndSwapAdditionalBlocksField(args: {
  db: ReturnType<typeof getDb>;
  ownerEmail: string;
  documentId: string;
  propertyId: string;
  expectedContent: string;
  expectedExists: boolean;
  content: string;
  now: string;
}) {
  const updated = args.expectedExists
    ? await args.db
        .update(schema.documentBlockFieldContents)
        .set({ content: args.content, updatedAt: args.now })
        .where(
          and(
            eq(schema.documentBlockFieldContents.documentId, args.documentId),
            eq(schema.documentBlockFieldContents.propertyId, args.propertyId),
            eq(schema.documentBlockFieldContents.content, args.expectedContent),
          ),
        )
        .returning({ id: schema.documentBlockFieldContents.id })
    : await args.db
        .insert(schema.documentBlockFieldContents)
        .values({
          id: nanoid(),
          ownerEmail: args.ownerEmail,
          documentId: args.documentId,
          propertyId: args.propertyId,
          content: args.content,
          createdAt: args.now,
          updatedAt: args.now,
        })
        .onConflictDoNothing({
          target: [
            schema.documentBlockFieldContents.documentId,
            schema.documentBlockFieldContents.propertyId,
          ],
        })
        .returning({ id: schema.documentBlockFieldContents.id });
  if (updated.length === 0) {
    contractError(
      "FIELD_REVISION_CONFLICT",
      "The Blocks field changed before the mutation could commit.",
      { propertyId: args.propertyId },
    );
  }
}

async function readExistingReceipt(
  databaseId: string,
  idempotencyKey: string,
  expectedDigest: string,
  db: Db = getDb(),
): Promise<ContentDatabaseBlockMutationResult | null> {
  const [stored] = await db
    .select()
    .from(schema.contentDatabaseRowMutationReceipts)
    .where(
      and(
        eq(schema.contentDatabaseRowMutationReceipts.databaseId, databaseId),
        eq(
          schema.contentDatabaseRowMutationReceipts.idempotencyKey,
          idempotencyKey,
        ),
      ),
    );
  if (!stored) return null;
  if (stored.payloadDigest !== expectedDigest) {
    contractError(
      "IDEMPOTENCY_KEY_REUSED",
      "This idempotency key was already used for a different mutation.",
      { idempotencyKey },
    );
  }
  const parsed = JSON.parse(
    stored.resultJson,
  ) as ContentDatabaseBlockMutationResult;
  if (!parsed.receipt?.target?.propertyId) {
    contractError(
      "IDEMPOTENCY_KEY_REUSED",
      "This idempotency key belongs to a different mutation contract.",
      { idempotencyKey },
    );
  }
  return {
    receipt: {
      ...parsed.receipt,
      idempotency: { ...parsed.receipt.idempotency, result: "replayed" },
    },
  };
}

async function verifyResult(
  result: ContentDatabaseBlockMutationResult,
  db: Db = getDb(),
): Promise<ContentDatabaseBlockMutationResult> {
  const loaded = await loadField({
    target: result.receipt.target,
    role: "viewer",
    db,
  });
  const blocks = serializedBlocks(loaded.markdown, loaded.identity);
  const order = blocks.map((block) => block.id);
  if (
    loaded.row.revision !== result.receipt.revisions.row.after ||
    loaded.identity.revision !== result.receipt.revisions.field.after ||
    loaded.identity.contentHash !== result.receipt.readback.contentHash ||
    JSON.stringify(order) !== JSON.stringify(result.receipt.readback.order)
  ) {
    contractError(
      "IDEMPOTENCY_REPLAY_DRIFT",
      "The committed Blocks field changed after this mutation.",
      { receiptId: result.receipt.receiptId },
    );
  }
  return {
    receipt: {
      ...result.receipt,
      readback: {
        verified: true,
        fieldRevision: loaded.identity.revision,
        contentHash: loaded.identity.contentHash,
        order,
        blocks,
      },
    },
  };
}

function outcomeFor(
  input: MutationInput,
  changed: boolean,
  inserted: boolean,
): ContentDatabaseBlockMutationReceipt["outcome"] {
  if (!changed) return "unchanged";
  if (inserted) return "inserted";
  if (input.operation === "delete") return "deleted";
  if (input.operation === "reorder") return "reordered";
  return "updated";
}

function assertMutationRevisions(
  loaded: LoadedField,
  input: MutationInput,
): void {
  assertSchema(loaded.context, input.expectedSchemaRevision);
  if (loaded.row.revision !== input.expectedRowRevision) {
    contractError("ROW_REVISION_CONFLICT", "The database row changed.", {
      expected: input.expectedRowRevision,
      actual: loaded.row.revision,
    });
  }
  if (loaded.identity.identityStatus === "stale") {
    contractError(
      "BLOCK_IDENTITY_STALE",
      "The Blocks field changed without a matching identity revision.",
    );
  }
  if (loaded.identity.revision !== input.expectedFieldRevision) {
    contractError("FIELD_REVISION_CONFLICT", "The Blocks field changed.", {
      expected: input.expectedFieldRevision,
      actual: loaded.identity.revision,
    });
  }
}

async function prepareBlockMutation(
  db: Db,
  loaded: LoadedField,
  input: MutationInput,
) {
  assertMutationRevisions(loaded, input);
  const generatedInsertId = `block_${nanoid(16)}`;
  const resolved = actionMutation(input, loaded.identity, generatedInsertId);
  if (resolved.insertedBlockId) {
    const used = await db
      .select({ id: schema.documentBlocks.id })
      .from(schema.documentBlocks)
      .where(eq(schema.documentBlocks.id, resolved.insertedBlockId));
    if (used.length > 0) {
      contractError(
        "BLOCK_ID_ALREADY_USED",
        "The requested block ID has already been used.",
        { blockId: resolved.insertedBlockId },
      );
    }
  }
  let changed;
  try {
    changed = mutateBlocksFieldDocument({
      markdown: loaded.markdown,
      identity: loaded.identity,
      mutation: resolved.mutation,
      insertedBlockId: resolved.insertedBlockId,
      createInsertedDescendantId: () => `block_${nanoid(16)}`,
    });
  } catch (error) {
    mapMutationFailure(error);
  }
  return { resolved, changed };
}

type PreparedBlockMutation = Awaited<ReturnType<typeof prepareBlockMutation>>;

async function recordBlockMutation(args: {
  tx: Db;
  input: MutationInput;
  inputDigest: string;
  loaded: LoadedField;
  changed: PreparedBlockMutation["changed"];
  resolved: PreparedBlockMutation["resolved"];
  postIdentity: BlocksFieldIdentity;
  markdown: string;
  now: string;
}): Promise<ContentDatabaseBlockMutationResult> {
  const {
    tx,
    input,
    inputDigest,
    loaded,
    changed,
    resolved,
    postIdentity,
    markdown,
    now,
  } = args;
  const postRow = await rowSnapshot(
    tx,
    input.target.databaseId,
    input.target.itemId,
    input.target.rowDocumentId,
    revisionPropertyIds(loaded.context),
  );
  if (!postRow) {
    contractError(
      "READBACK_MISMATCH",
      "The database row disappeared during block mutation.",
    );
  }
  const postBlocks = serializedBlocks(markdown, postIdentity);
  const preOrder = loaded.identity.blocks.map((block) => block.id);
  const postOrder = postBlocks.map((block) => block.id);
  const deletedBlockIds = preOrder.filter(
    (blockId) => !postOrder.includes(blockId),
  );
  const insertedBlockIds = postOrder.filter(
    (blockId) => !preOrder.includes(blockId),
  );
  const primaryBlockId =
    resolved.insertedBlockId ?? ("blockId" in input ? input.blockId : null);
  const affectedBlockIds = [
    ...new Set([
      ...(primaryBlockId ? [primaryBlockId] : []),
      ...insertedBlockIds,
      ...deletedBlockIds,
    ]),
  ];
  const receiptId = `block_receipt_${nanoid(18)}`;
  const receipt: ContentDatabaseBlockMutationReceipt = {
    receiptId,
    operation: input.operation,
    outcome: outcomeFor(
      input,
      changed.changed,
      resolved.insertedBlockId !== undefined,
    ),
    target: input.target,
    rowLink: {
      urlPath: `/page/${input.target.rowDocumentId}`,
      label: "Open database row",
    },
    schemaRevision: loaded.context.schemaRevision,
    idempotency: {
      key: input.idempotencyKey,
      result: "applied",
      payloadDigest: inputDigest,
    },
    revisions: {
      row: { before: loaded.row.revision, after: postRow.revision },
      field: {
        before: loaded.identity.revision,
        after: postIdentity.revision,
      },
    },
    affected: {
      blockIds: affectedBlockIds,
      deletedBlockIds,
      order: postOrder,
    },
    readback: {
      verified: true,
      fieldRevision: postIdentity.revision,
      contentHash: postIdentity.contentHash,
      order: postOrder,
      blocks: postBlocks,
    },
  };
  const storedResult: ContentDatabaseBlockMutationResult = { receipt };
  await tx.insert(schema.contentDatabaseRowMutationReceipts).values({
    id: receiptId,
    ownerEmail: loaded.ownerEmail,
    orgId: loaded.context.database.orgId,
    spaceId: input.target.spaceId,
    databaseId: input.target.databaseId,
    databaseDocumentId: input.target.databaseDocumentId,
    operation: `block:${input.operation}`,
    itemId: input.target.itemId,
    documentId: input.target.rowDocumentId,
    idempotencyKey: input.idempotencyKey,
    payloadDigest: inputDigest,
    schemaRevision: loaded.context.schemaRevision,
    preRowRevision: loaded.row.revision,
    postRowRevision: postRow.revision,
    resultJson: JSON.stringify(storedResult),
    createdAt: now,
    updatedAt: now,
  });
  return storedResult;
}

class ReplayedBlockMutation extends Error {
  constructor(readonly result: ContentDatabaseBlockMutationResult) {
    super("The block mutation already committed.");
  }
}

function mapBlockIdCollision(
  error: unknown,
  insertedBlockId: string | undefined,
): never {
  if (
    error instanceof BlocksFieldIdCollisionError ||
    (insertedBlockId && isUniqueConstraintError(error))
  ) {
    contractError(
      "BLOCK_ID_ALREADY_USED",
      "The requested block ID has already been used.",
      {
        blockId:
          error instanceof BlocksFieldIdCollisionError
            ? error.blockId
            : insertedBlockId,
      },
    );
  }
  throw error;
}

async function mutatePrimaryBlockThroughLiveCopy(
  input: MutationInput,
  inputDigest: string,
  loaded: LoadedField,
): Promise<ContentDatabaseBlockMutationResult | false> {
  if (
    loaded.storageTarget !== "document_body" ||
    !(await isLiveBodyWriterPage(input.target.rowDocumentId))
  )
    return false;
  let insertedBlockId: string | undefined;
  let result: ContentDatabaseBlockMutationResult | undefined;
  const beforeWrite = async (exec: DbExec) => {
    const tx = drizzleOverExec(exec);
    const replay = await readExistingReceipt(
      input.target.databaseId,
      input.idempotencyKey,
      inputDigest,
      tx,
    );
    if (replay) throw new ReplayedBlockMutation(replay);
    for (const documentId of [
      input.target.databaseDocumentId,
      input.target.rowDocumentId,
    ]) {
      await assertAccess("document", documentId, "editor", {
        ...currentAccess(),
        transaction: exec,
      });
    }
    const current = await loadField({
      target: input.target,
      role: "editor",
      db: tx,
      accessAlreadyResolved: true,
    });
    assertMutationRevisions(current, input);
    if (current.storageTarget !== "document_body") {
      contractError(
        "FIELD_REVISION_CONFLICT",
        "The Blocks field changed before the mutation could commit.",
        { propertyId: input.target.propertyId },
      );
    }
  };
  try {
    const { resolved, changed } = await prepareBlockMutation(
      getDb(),
      loaded,
      input,
    );
    insertedBlockId = resolved.insertedBlockId;
    assertNoNewlySharedVideoIds(loaded.markdown, changed.markdown);
    await editContentLiveCopy(input.target.rowDocumentId, {
      cause: {
        operation: "mutate-content-database-block",
        lockCollections: [input.target.databaseId],
        expectedBlocksFieldRevision: {
          propertyId: input.target.propertyId,
          revision: input.expectedFieldRevision,
        },
        blocksFieldIdentity: {
          propertyId: input.target.propertyId,
          preferredIdsByPath: changed.preferredIdsByPath,
          rejectCrossFieldIdRemapping: true,
        },
        beforeWrite,
      },
      edit: CONTENT_LIVE_COPY_EDITS.replaceBody,
      input: { expected: loaded.markdown, content: changed.markdown },
      persist: async (exec, commit) => {
        const tx = drizzleOverExec(exec);
        const postIdentity = await readBlocksFieldIdentity({
          db: tx,
          documentId: input.target.rowDocumentId,
          propertyId: input.target.propertyId,
          markdown: commit.text,
        });
        if (
          resolved.insertedBlockId &&
          !postIdentity.blocks.some(
            (block) => block.id === resolved.insertedBlockId,
          )
        ) {
          contractError(
            "BLOCK_ID_ALREADY_USED",
            "The requested block ID has already been used.",
            { blockId: resolved.insertedBlockId },
          );
        }
        const now = new Date().toISOString();
        if (commit.changed)
          await touchContentDatabase(tx, input.target.databaseId, now);
        result = await recordBlockMutation({
          tx,
          input,
          inputDigest,
          loaded,
          changed: { ...changed, changed: commit.changed },
          resolved,
          postIdentity,
          markdown: commit.text,
          now,
        });
      },
    });
  } catch (error) {
    if (error instanceof ReplayedBlockMutation) return error.result;
    if (
      liveCopyBaseChanged(error) ||
      (error instanceof ActionContractError &&
        (error.errorCode === "ROW_REVISION_CONFLICT" ||
          error.errorCode === "FIELD_REVISION_CONFLICT"))
    ) {
      const replay = await readExistingReceipt(
        input.target.databaseId,
        input.idempotencyKey,
        inputDigest,
      );
      if (replay) return replay;
    }
    if (liveCopyWriteLeftPath(error)) return false;
    if (liveCopyBaseChanged(error)) {
      contractError(
        "FIELD_REVISION_CONFLICT",
        "The Blocks field changed before the mutation could commit.",
        { propertyId: input.target.propertyId },
      );
    }
    mapBlockIdCollision(
      unrepresentableBodyError(error) ?? error,
      insertedBlockId,
    );
  }
  if (!result)
    throw new Error("The live block mutation committed without a receipt.");
  return result;
}

export async function mutateDatabaseBlock(
  input: MutationInput,
): Promise<ContentDatabaseBlockMutationResult> {
  const inputDigest = mutationDigest(input);
  await loadField({ target: input.target, role: "editor" });
  const result = await withContentDatabaseMutationLock(
    input.target.databaseId,
    async () => {
      const replay = await readExistingReceipt(
        input.target.databaseId,
        input.idempotencyKey,
        inputDigest,
      );
      if (replay) return replay;
      const loaded = await loadField({ target: input.target, role: "editor" });
      const liveResult = await mutatePrimaryBlockThroughLiveCopy(
        input,
        inputDigest,
        loaded,
      );
      if (liveResult) return liveResult;
      return getDb().transaction(async (transaction) => {
        const tx = transaction as unknown as Db;
        await lockContentDatabaseMutation(tx, input.target.databaseId);
        const lockedReplay = await readExistingReceipt(
          input.target.databaseId,
          input.idempotencyKey,
          inputDigest,
          tx,
        );
        if (lockedReplay) return lockedReplay;
        const primaryBlocksFields = await lockPrimaryBlocksFields(
          tx,
          input.target.rowDocumentId,
        );
        const [lockedDocument] = await tx
          .update(schema.documents)
          .set({ updatedAt: sql`${schema.documents.updatedAt}` })
          .where(
            and(
              eq(schema.documents.id, input.target.rowDocumentId),
              isNull(schema.documents.trashedAt),
            ),
          )
          .returning({ id: schema.documents.id });
        if (!lockedDocument) {
          contractError(
            "ROW_NOT_FOUND",
            "The exact database row was not found.",
            {
              documentId: input.target.rowDocumentId,
            },
            404,
          );
        }
        const loaded = await loadField({
          target: input.target,
          role: "editor",
          db: tx,
          accessAlreadyResolved: true,
        });
        const { resolved, changed } = await prepareBlockMutation(
          tx,
          loaded,
          input,
        );
        const now = new Date().toISOString();
        let postIdentity = loaded.identity;
        if (changed.changed) {
          await writeMarkdown(tx, loaded, input.target, changed.markdown, now);
          try {
            const fieldsToPersist =
              loaded.storageTarget === "document_body"
                ? primaryBlocksFields
                : [
                    {
                      propertyId: input.target.propertyId,
                      ownerEmail: loaded.ownerEmail,
                    },
                  ];
            if (
              !fieldsToPersist.some(
                (field) => field.propertyId === input.target.propertyId,
              )
            ) {
              throw new Error(
                "Primary Blocks membership changed before the operation completed.",
              );
            }
            for (const field of fieldsToPersist) {
              const isTarget = field.propertyId === input.target.propertyId;
              await persistBlocksFieldIdentity({
                db: tx,
                ownerEmail: field.ownerEmail,
                documentId: input.target.rowDocumentId,
                propertyId: field.propertyId,
                previousMarkdown: loaded.markdown,
                markdown: changed.markdown,
                ...(isTarget
                  ? {
                      expectedRevision: input.expectedFieldRevision,
                      preferredIdsByPath: changed.preferredIdsByPath,
                      rejectCrossFieldIdRemapping: true,
                    }
                  : {}),
                now,
              });
            }
          } catch (error) {
            mapBlockIdCollision(error, resolved.insertedBlockId);
          }
          postIdentity = await readBlocksFieldIdentity({
            db: tx,
            documentId: input.target.rowDocumentId,
            propertyId: input.target.propertyId,
            markdown: changed.markdown,
          });
          if (
            resolved.insertedBlockId &&
            !postIdentity.blocks.some(
              (block) => block.id === resolved.insertedBlockId,
            )
          ) {
            contractError(
              "BLOCK_ID_ALREADY_USED",
              "The requested block ID has already been used.",
              { blockId: resolved.insertedBlockId },
            );
          }
          await touchContentDatabase(tx, input.target.databaseId, now);
        }
        return recordBlockMutation({
          tx,
          input,
          inputDigest,
          loaded,
          changed,
          resolved,
          postIdentity,
          markdown: changed.markdown,
          now,
        });
      });
    },
  );
  return verifyResult(result);
}
