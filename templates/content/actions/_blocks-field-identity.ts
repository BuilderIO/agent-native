import { and, asc, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  blocksContentHash,
  blocksFieldId,
  exposeBlocksFieldIdentity,
  legacyBlocksFieldIdentity,
  materializeLegacyBlocksFieldIdentity,
  reconcileBlocksFieldIdentity,
  type BlocksFieldIdentity,
  type StoredBlocksFieldIdentity,
} from "../shared/blocks-field-identity.js";
import { lockDatabaseMemberships } from "./_database-membership-lock.js";

type ContentDb = ReturnType<typeof getDb>;

export interface PrimaryBlocksField {
  propertyId: string;
  ownerEmail: string;
}

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

function groups<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export async function lockPrimaryBlocksFields(
  db: ContentDb,
  documentId: string,
): Promise<PrimaryBlocksField[]> {
  const memberships = await db
    .select({ id: schema.contentDatabaseItems.id })
    .from(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.documentId, documentId));
  const membershipIds = memberships.map((membership) => membership.id);
  await lockDatabaseMemberships(db, membershipIds);
  if (membershipIds.length === 0) return [];

  const fields = await db
    .select({
      propertyId: schema.contentDatabases.primaryBlocksPropertyId,
      ownerEmail: schema.contentDatabases.ownerEmail,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.contentDatabases,
      eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
    )
    .where(inArray(schema.contentDatabaseItems.id, membershipIds));
  return [
    ...new Map(
      fields.flatMap((field) =>
        field.propertyId ? [[field.propertyId, field.ownerEmail] as const] : [],
      ),
    ),
  ].map(([propertyId, ownerEmail]) => ({ propertyId, ownerEmail }));
}

async function loadStoredIdentity(
  db: ContentDb,
  fieldId: string,
): Promise<StoredBlocksFieldIdentity | null> {
  const [field] = await db
    .select()
    .from(schema.documentBlockFields)
    .where(eq(schema.documentBlockFields.id, fieldId));
  if (!field) return null;
  const blocks = await db
    .select()
    .from(schema.documentBlocks)
    .where(eq(schema.documentBlocks.fieldId, fieldId))
    .orderBy(asc(schema.documentBlocks.sortIndex));
  return {
    fieldId,
    revision: field.revision,
    contentHash: field.contentHash,
    blocks: blocks.map((block) => ({
      id: block.id,
      parentId: block.parentId,
      kind: block.kind,
      position: block.position,
      addressable: block.addressable,
      contentHash: block.contentHash,
      markdown: block.markdown,
      state: block.state === "deleted" ? "deleted" : "live",
      deletedAtRevision: block.deletedAtRevision,
      recoveredAtRevision: block.recoveredAtRevision,
    })),
  };
}

export async function readBlocksFieldIdentity(args: {
  db?: ContentDb;
  documentId: string;
  propertyId: string;
  markdown: string;
}): Promise<BlocksFieldIdentity> {
  const fieldId = blocksFieldId(args.documentId, args.propertyId);
  const stored = await loadStoredIdentity(args.db ?? getDb(), fieldId);
  return stored
    ? exposeBlocksFieldIdentity(stored, args.markdown)
    : legacyBlocksFieldIdentity(args);
}

export async function readBlocksFieldIdentities(args: {
  db?: ContentDb;
  fields: Array<{
    documentId: string;
    propertyId: string;
    markdown: string;
  }>;
}): Promise<Map<string, BlocksFieldIdentity>> {
  const db = args.db ?? getDb();
  const inputs = new Map(
    args.fields.map((field) => [
      blocksFieldId(field.documentId, field.propertyId),
      field,
    ]),
  );
  const storedFields: Array<typeof schema.documentBlockFields.$inferSelect> =
    [];
  for (const ids of groups([...inputs.keys()], 200)) {
    if (ids.length === 0) continue;
    storedFields.push(
      ...(await db
        .select()
        .from(schema.documentBlockFields)
        .where(inArray(schema.documentBlockFields.id, ids))),
    );
  }
  const storedById = new Map(storedFields.map((field) => [field.id, field]));
  const storedBlocks: Array<typeof schema.documentBlocks.$inferSelect> = [];
  for (const ids of groups(
    storedFields.map((field) => field.id),
    200,
  )) {
    if (ids.length === 0) continue;
    storedBlocks.push(
      ...(await db
        .select()
        .from(schema.documentBlocks)
        .where(inArray(schema.documentBlocks.fieldId, ids))
        .orderBy(asc(schema.documentBlocks.sortIndex))),
    );
  }
  const blocksByField = new Map<
    string,
    Array<typeof schema.documentBlocks.$inferSelect>
  >();
  for (const block of storedBlocks) {
    const values = blocksByField.get(block.fieldId) ?? [];
    values.push(block);
    blocksByField.set(block.fieldId, values);
  }

  const result = new Map<string, BlocksFieldIdentity>();
  for (const [fieldId, input] of inputs) {
    const field = storedById.get(fieldId);
    if (!field) {
      result.set(fieldId, legacyBlocksFieldIdentity(input));
      continue;
    }
    result.set(
      fieldId,
      exposeBlocksFieldIdentity(
        {
          fieldId,
          revision: field.revision,
          contentHash: field.contentHash,
          blocks: (blocksByField.get(fieldId) ?? []).map((block) => ({
            id: block.id,
            parentId: block.parentId,
            kind: block.kind,
            position: block.position,
            addressable: block.addressable,
            contentHash: block.contentHash,
            markdown: block.markdown,
            state: block.state === "deleted" ? "deleted" : "live",
            deletedAtRevision: block.deletedAtRevision,
            recoveredAtRevision: block.recoveredAtRevision,
          })),
        },
        input.markdown,
      ),
    );
  }
  return result;
}

export async function persistBlocksFieldIdentity(args: {
  db: ContentDb;
  ownerEmail: string;
  documentId: string;
  propertyId: string;
  previousMarkdown: string;
  markdown: string;
  expectedRevision?: number;
  now: string;
}): Promise<StoredBlocksFieldIdentity> {
  const fieldId = blocksFieldId(args.documentId, args.propertyId);
  const stored = await loadStoredIdentity(args.db, fieldId);
  const actualRevision = stored?.revision ?? 0;
  if (
    args.expectedRevision !== undefined &&
    args.expectedRevision !== actualRevision
  ) {
    throw new Error(
      `Blocks field revision conflict: expected ${args.expectedRevision}, current ${actualRevision}`,
    );
  }

  let previous =
    stored ??
    materializeLegacyBlocksFieldIdentity({
      documentId: args.documentId,
      propertyId: args.propertyId,
      markdown: args.previousMarkdown,
    });

  // A legacy whole-field writer may have changed Markdown without updating the
  // sidecar. Reconcile exact unique blocks first and report the resulting extra
  // revision instead of silently pretending continuity was complete.
  if (previous.contentHash !== blocksContentHash(args.previousMarkdown)) {
    previous = reconcileBlocksFieldIdentity({
      documentId: args.documentId,
      propertyId: args.propertyId,
      previous,
      markdown: args.previousMarkdown,
      createId: () => `block_${nanoid(16)}`,
    });
  }

  let next = reconcileBlocksFieldIdentity({
    documentId: args.documentId,
    propertyId: args.propertyId,
    previous,
    markdown: args.markdown,
    createId: () => `block_${nanoid(16)}`,
  });

  if (next.blocks.length > 0) {
    const existingOwners = await args.db
      .select({
        id: schema.documentBlocks.id,
        fieldId: schema.documentBlocks.fieldId,
      })
      .from(schema.documentBlocks)
      .where(
        inArray(
          schema.documentBlocks.id,
          next.blocks.map((block) => block.id),
        ),
      );
    const remappedIds = new Map<string, string>();
    const reserved = new Set(next.blocks.map((block) => block.id));
    for (const existing of existingOwners) {
      if (existing.fieldId === fieldId) continue;
      let replacement = `block_${nanoid(16)}`;
      while (reserved.has(replacement)) replacement = `block_${nanoid(16)}`;
      reserved.add(replacement);
      remappedIds.set(existing.id, replacement);
    }
    if (remappedIds.size > 0) {
      next = {
        ...next,
        blocks: next.blocks.map((block) => ({
          ...block,
          id: remappedIds.get(block.id) ?? block.id,
          parentId: block.parentId
            ? (remappedIds.get(block.parentId) ?? block.parentId)
            : null,
        })),
      };
    }
  }

  if (stored) {
    const applied = await args.db
      .update(schema.documentBlockFields)
      .set({
        revision: next.revision,
        contentHash: next.contentHash,
        updatedAt: args.now,
      })
      .where(
        and(
          eq(schema.documentBlockFields.id, fieldId),
          eq(schema.documentBlockFields.revision, actualRevision),
        ),
      )
      .returning({ id: schema.documentBlockFields.id });
    if (applied.length === 0) {
      throw new Error(
        `Blocks field revision conflict: expected ${actualRevision}, current revision changed`,
      );
    }
  } else {
    const inserted = await args.db
      .insert(schema.documentBlockFields)
      .values({
        id: fieldId,
        ownerEmail: args.ownerEmail,
        documentId: args.documentId,
        propertyId: args.propertyId,
        revision: next.revision,
        contentHash: next.contentHash,
        createdAt: args.now,
        updatedAt: args.now,
      })
      .onConflictDoNothing()
      .returning({ id: schema.documentBlockFields.id });
    if (inserted.length === 0) {
      throw new Error(
        "Blocks field revision conflict: concurrent first materialization",
      );
    }
  }
  await args.db
    .delete(schema.documentBlocks)
    .where(eq(schema.documentBlocks.fieldId, fieldId));
  if (next.blocks.length > 0) {
    await args.db.insert(schema.documentBlocks).values(
      next.blocks.map((block, sortIndex) => ({
        id: block.id,
        ownerEmail: args.ownerEmail,
        fieldId,
        parentId: block.parentId,
        kind: block.kind,
        position: block.position,
        sortIndex,
        addressable: block.addressable,
        contentHash: block.contentHash,
        markdown: block.markdown,
        state: block.state,
        deletedAtRevision: block.deletedAtRevision,
        recoveredAtRevision: block.recoveredAtRevision,
        createdAt: args.now,
        updatedAt: args.now,
      })),
    );
  }
  return next;
}

export async function deleteBlocksFieldIdentity(args: {
  db: ContentDb;
  documentId?: string;
  documentIds?: string[];
  propertyId?: string;
  propertyIds?: string[];
}): Promise<void> {
  if (
    !args.documentId &&
    !args.documentIds?.length &&
    !args.propertyId &&
    !args.propertyIds?.length
  ) {
    return;
  }
  const clauses = [];
  if (args.documentId) {
    clauses.push(eq(schema.documentBlockFields.documentId, args.documentId));
  }
  if (args.documentIds?.length) {
    clauses.push(
      inArray(schema.documentBlockFields.documentId, args.documentIds),
    );
  }
  if (args.propertyId) {
    clauses.push(eq(schema.documentBlockFields.propertyId, args.propertyId));
  }
  if (args.propertyIds?.length) {
    clauses.push(
      inArray(schema.documentBlockFields.propertyId, args.propertyIds),
    );
  }
  const fields = await args.db
    .select({ id: schema.documentBlockFields.id })
    .from(schema.documentBlockFields)
    .where(clauses.length === 1 ? clauses[0] : and(...clauses));
  if (fields.length === 0) return;
  await args.db.delete(schema.documentBlocks).where(
    inArray(
      schema.documentBlocks.fieldId,
      fields.map((field) => field.id),
    ),
  );
  await args.db.delete(schema.documentBlockFields).where(
    inArray(
      schema.documentBlockFields.id,
      fields.map((field) => field.id),
    ),
  );
}
