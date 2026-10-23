import { createHash } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import type {
  DocumentPropertyOption,
  DocumentPropertyValue,
} from "../shared/api.js";
import {
  serializePropertyOptions,
  serializePropertyValue,
} from "../shared/properties.js";
import { chunks, bulkChunkSizeForColumnCount } from "./_batch-utils.js";
import { builderCmsEntryStatus } from "./_builder-cms-unpublished-changes.js";
import {
  propertyDefinitionsPositionScope,
  withPositionLock,
} from "./_position-utils.js";

type Db = Pick<
  ReturnType<typeof getDb>,
  "select" | "insert" | "update" | "delete"
>;

export const BUILDER_STATUS_PROPERTY_NAME = "Builder status";

/** Option ids are `builderCmsEntryStatus` results; Builder's own words. */
const BUILDER_STATUS_OPTIONS: DocumentPropertyOption[] = [
  { id: "published", name: "Published", color: "green" },
  { id: "draft", name: "Draft", color: "gray" },
  { id: "unpublished_changes", name: "Unpublished changes", color: "orange" },
];

function hashId(prefix: string, key: string) {
  return `${prefix}_${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

export function builderStatusPropertyId(databaseId: string) {
  return hashId("content_builder_status_property", databaseId);
}

// Two writers racing for a row's first status share this id, so the second
// updates the first's value instead of adding a duplicate.
function builderStatusValueId(propertyId: string, documentId: string) {
  return hashId("content_builder_status_value", `${propertyId}:${documentId}`);
}

async function builderStatusTarget(db: Db, sourceId: string) {
  const [target] = await db
    .select({
      databaseId: schema.contentDatabases.id,
      ownerEmail: schema.contentDatabases.ownerEmail,
      orgId: schema.contentDatabases.orgId,
    })
    .from(schema.contentDatabaseSources)
    .innerJoin(
      schema.contentDatabases,
      eq(schema.contentDatabases.id, schema.contentDatabaseSources.databaseId),
    )
    .where(
      and(
        eq(schema.contentDatabaseSources.id, sourceId),
        eq(schema.contentDatabaseSources.sourceType, "builder-cms"),
      ),
    )
    .limit(1);
  return target ?? null;
}

async function existingBuilderStatusPropertyId(db: Db, databaseId: string) {
  const [definition] = await db
    .select({ id: schema.documentPropertyDefinitions.id })
    .from(schema.documentPropertyDefinitions)
    .where(
      and(
        eq(schema.documentPropertyDefinitions.databaseId, databaseId),
        eq(schema.documentPropertyDefinitions.systemRole, "builder_status"),
      ),
    )
    .limit(1);
  return definition?.id ?? null;
}

async function createBuilderStatusProperty(args: {
  target: NonNullable<Awaited<ReturnType<typeof builderStatusTarget>>>;
  now: string;
}) {
  const db = getDb();
  return withPositionLock(
    propertyDefinitionsPositionScope(args.target.databaseId),
    async () => {
      const existing = await existingBuilderStatusPropertyId(
        db,
        args.target.databaseId,
      );
      if (existing) return existing;
      const [minPosition] = await db
        .select({ min: sql<unknown>`MIN(position)` })
        .from(schema.documentPropertyDefinitions)
        .where(
          eq(
            schema.documentPropertyDefinitions.databaseId,
            args.target.databaseId,
          ),
        );
      const min = Number(minPosition?.min ?? 0);
      await db
        .insert(schema.documentPropertyDefinitions)
        .values({
          id: builderStatusPropertyId(args.target.databaseId),
          ownerEmail: args.target.ownerEmail,
          orgId: args.target.orgId,
          databaseId: args.target.databaseId,
          systemRole: "builder_status",
          name: BUILDER_STATUS_PROPERTY_NAME,
          type: "select",
          visibility: "always_show",
          optionsJson: serializePropertyOptions({
            options: BUILDER_STATUS_OPTIONS,
          }),
          // First, next to the title, where the status is easy to scan.
          position: (Number.isSafeInteger(min) ? min : 0) - 1,
          createdAt: args.now,
          updatedAt: args.now,
        })
        .onConflictDoNothing();
      return existingBuilderStatusPropertyId(db, args.target.databaseId);
    },
  );
}

/**
 * Writes each row's Builder status from the source values just stored for it.
 * Every path that stores a Builder row's `published`, autosave flag, or
 * unpublished-changes record calls this, or the status goes stale until the
 * next refresh. `createProperty` is for attach and refresh, which run outside
 * a transaction; inside one, rows are only updated once the property exists.
 */
export async function writeBuilderStatusValues(
  db: Db,
  args: {
    sourceId: string;
    rows: ReadonlyArray<{
      documentId: string | null | undefined;
      sourceValues: Record<string, DocumentPropertyValue> | null | undefined;
    }>;
    now: string;
    createProperty?: boolean;
  },
) {
  const rows = args.rows.filter(
    (
      row,
    ): row is { documentId: string; sourceValues: typeof row.sourceValues } =>
      Boolean(row.documentId),
  );
  if (rows.length === 0) return;
  const target = await builderStatusTarget(db, args.sourceId);
  if (!target) return;
  const propertyId = args.createProperty
    ? await createBuilderStatusProperty({ target, now: args.now })
    : await existingBuilderStatusPropertyId(db, target.databaseId);
  if (!propertyId) return;

  const statusByDocumentId = new Map(
    rows.map((row) => [
      row.documentId,
      builderCmsEntryStatus(row.sourceValues),
    ]),
  );
  const documentIds = [...statusByDocumentId.keys()];
  const existing: Array<{ id: string; documentId: string; valueJson: string }> =
    [];
  for (const documentIdChunk of chunks(
    documentIds,
    bulkChunkSizeForColumnCount(1),
  )) {
    existing.push(
      ...(await db
        .select({
          id: schema.documentPropertyValues.id,
          documentId: schema.documentPropertyValues.documentId,
          valueJson: schema.documentPropertyValues.valueJson,
        })
        .from(schema.documentPropertyValues)
        .where(
          and(
            eq(schema.documentPropertyValues.propertyId, propertyId),
            inArray(schema.documentPropertyValues.documentId, documentIdChunk),
          ),
        )),
    );
  }
  const existingByDocumentId = new Map(
    existing.map((value) => [value.documentId, value]),
  );

  const upserts: Array<typeof schema.documentPropertyValues.$inferInsert> = [];
  const deletedIds: string[] = [];
  for (const [documentId, status] of statusByDocumentId) {
    const current = existingByDocumentId.get(documentId);
    if (!status) {
      // An entry in no state Builder names has no status, not a stale one.
      if (current) deletedIds.push(current.id);
      continue;
    }
    const valueJson = serializePropertyValue(status);
    if (current?.valueJson === valueJson) continue;
    upserts.push({
      id: current?.id ?? builderStatusValueId(propertyId, documentId),
      ownerEmail: target.ownerEmail,
      documentId,
      propertyId,
      valueJson,
      createdAt: args.now,
      updatedAt: args.now,
    });
  }
  for (const chunk of chunks(upserts, bulkChunkSizeForColumnCount(7))) {
    await db
      .insert(schema.documentPropertyValues)
      .values(chunk)
      .onConflictDoUpdate({
        target: schema.documentPropertyValues.id,
        set: {
          valueJson: sql`excluded.value_json`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  for (const chunk of chunks(deletedIds, bulkChunkSizeForColumnCount(1))) {
    await db
      .delete(schema.documentPropertyValues)
      .where(inArray(schema.documentPropertyValues.id, chunk));
  }
}

/** Clears the status of rows leaving a Builder source, which no longer has one. */
export async function clearBuilderStatusValues(
  db: Db,
  args: { databaseId: string; documentIds: readonly string[] },
) {
  if (args.documentIds.length === 0) return;
  const propertyId = await existingBuilderStatusPropertyId(db, args.databaseId);
  if (!propertyId) return;
  for (const chunk of chunks(
    [...args.documentIds],
    bulkChunkSizeForColumnCount(1),
  )) {
    await db
      .delete(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.propertyId, propertyId),
          inArray(schema.documentPropertyValues.documentId, chunk),
        ),
      );
  }
}
