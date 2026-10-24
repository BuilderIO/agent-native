import { ActionContractError } from "@agent-native/core";
import { and, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  isBlocksPropertyType,
  isComputedPropertyType,
  type DocumentPropertyType,
} from "../shared/properties.js";

type Db = ReturnType<typeof getDb>;

/**
 * A property's generation changes on every committed change to it, A → B → A
 * included, so a writer can tell "still the value I read" from "changed, then
 * changed back". Database triggers stamp it from one shared sequence, so
 * compare generations for equality only: the steps between them are not +1.
 *
 * While a property has a stored value, its generation is that value row's own
 * number, which a trigger renews whenever the value changes. Once the value is
 * deleted outright, it's the number a second trigger stamped on a tombstone
 * for that page and property, so a property that was empty, then filled, then
 * cleared can't read 0 again and pass an old token. A property that has never
 * had a value, or whose value hasn't changed since generations began, is 0.
 *
 * Every committed change sets a number no reader has seen yet, which is all an
 * equality check needs. Taking the larger of two numbers would not be safe: a
 * write can take its number before an unrelated deletion takes a larger one,
 * then commit after it.
 */
export type PropertyGenerations = Record<string, number>;

export interface StoredPropertyGenerations {
  /** The generation of one property on one page that was read. */
  of(documentId: string, propertyId: string): number;
}

export interface PropertyGenerationConflict {
  propertyId: string;
  expected: number;
  current: number;
}

/**
 * A property's change ID is its stored value's generation, or null when it has
 * no stored value. It names the write behind the current value, so it changes
 * exactly when this value is written anew. Use it to act once per change, and
 * the generation to guard a write. It's 0 for a value that hasn't changed
 * since generations began.
 */
export type PropertyChangeIds = Record<string, number | null>;

/** Change IDs, or tombstone generations, by page and then property. */
export type StoredPropertyChangeIds = Map<string, Map<string, number>>;

/** A stored generation as a number; NULL (never changed since) is 0. */
export function generationNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const generation = Number(value);
  if (!Number.isSafeInteger(generation)) {
    // guard:allow-bare-error — invariant: a trigger fills this column from a sequence
    throw new Error(
      `Stored property generation ${generation} is not a safe integer.`,
    );
  }
  return generation;
}

/**
 * Records the change IDs of the value rows a read or write returned. A page
 * holds one value row per property; were there two, the larger number would
 * win, so every reader agrees.
 */
export function recordPropertyChangeIds(
  stored: StoredPropertyChangeIds,
  rows: Iterable<{
    documentId: string;
    propertyId: string;
    generation: unknown;
  }>,
): StoredPropertyChangeIds {
  for (const row of rows) {
    const forPage = stored.get(row.documentId) ?? new Map<string, number>();
    const generation = generationNumber(row.generation);
    const previous = forPage.get(row.propertyId);
    forPage.set(
      row.propertyId,
      previous === undefined ? generation : Math.max(previous, generation),
    );
    stored.set(row.documentId, forPage);
  }
  return stored;
}

export function propertyChangeIdOf(
  stored: StoredPropertyChangeIds,
  documentId: string,
  propertyId: string,
): number | null {
  return stored.get(documentId)?.get(propertyId) ?? null;
}

/** Generations from stored values' change IDs and cleared values' tombstones. */
export function storedPropertyGenerations(
  changeIds: StoredPropertyChangeIds,
  tombstones: StoredPropertyChangeIds,
): StoredPropertyGenerations {
  return {
    of: (documentId, propertyId) =>
      propertyChangeIdOf(changeIds, documentId, propertyId) ??
      propertyChangeIdOf(tombstones, documentId, propertyId) ??
      0,
  };
}

/**
 * Reads the tombstones of these pages' cleared values. `lock` holds them until
 * the transaction ends.
 *
 * A read that returns values reads tombstones first, then takes each stored
 * value's generation from that value's own row: see recordPropertyChangeIds.
 * A deletion that lands between the two reads then pairs the emptied value
 * with an older generation, which only makes the next guarded write conflict
 * and reread. The other order could pair an empty value read before a change
 * with a tombstone written after it.
 */
export async function readPropertyTombstones(
  db: Db,
  documentIds: string[],
  options: { propertyIds?: string[]; lock?: boolean } = {},
): Promise<StoredPropertyChangeIds> {
  const tombstones: StoredPropertyChangeIds = new Map();
  if (!documentIds.length || options.propertyIds?.length === 0)
    return tombstones;
  const table = schema.documentPropertyValueTombstones;
  const query = db
    .select({
      documentId: table.documentId,
      propertyId: table.propertyId,
      generation: table.generation,
    })
    .from(table)
    .where(
      and(
        inArray(table.documentId, [...new Set(documentIds)]),
        options.propertyIds
          ? inArray(table.propertyId, [...new Set(options.propertyIds)])
          : undefined,
      ),
    );
  return recordPropertyChangeIds(
    tombstones,
    options.lock ? await query.for("update") : await query,
  );
}

/**
 * Reads the generations of these pages' properties, for a guard or from inside
 * the transaction that just wrote them. `lock` holds the value rows, then the
 * tombstones, until the transaction ends, so a guarded write can compare and
 * write without another writer in between. A read that returns values takes
 * generations from its own value rows instead: see readPropertyTombstones.
 */
export async function readPropertyGenerations(
  db: Db,
  documentIds: string[],
  options: { propertyIds?: string[]; lock?: boolean } = {},
): Promise<StoredPropertyGenerations> {
  const changeIds: StoredPropertyChangeIds = new Map();
  if (documentIds.length && options.propertyIds?.length !== 0) {
    const values = schema.documentPropertyValues;
    const query = db
      .select({
        documentId: values.documentId,
        propertyId: values.propertyId,
        generation: values.generation,
      })
      .from(values)
      .where(
        and(
          inArray(values.documentId, [...new Set(documentIds)]),
          options.propertyIds
            ? inArray(values.propertyId, [...new Set(options.propertyIds)])
            : undefined,
        ),
      );
    recordPropertyChangeIds(
      changeIds,
      options.lock ? await query.for("update") : await query,
    );
  }
  return storedPropertyGenerations(
    changeIds,
    await readPropertyTombstones(db, documentIds, options),
  );
}

type ReadProperty = { definition: { id: string; type: DocumentPropertyType } };

/** Blocks and computed fields take no guarded writes, so they're left out. */
function storedValueProperties(properties: ReadProperty[]) {
  return properties.filter(
    ({ definition }) =>
      !isBlocksPropertyType(definition.type) &&
      !isComputedPropertyType(definition.type),
  );
}

/**
 * One generation for each property a read returns, including ones with no
 * value yet, so a caller can guard a write to an empty property too.
 */
export function propertyGenerationsFor(
  documentId: string,
  properties: ReadProperty[],
  stored: StoredPropertyGenerations,
): PropertyGenerations {
  return Object.fromEntries(
    storedValueProperties(properties).map(({ definition }) => [
      definition.id,
      stored.of(documentId, definition.id),
    ]),
  );
}

/** One change ID for each property a read returns, as propertyGenerationsFor. */
export function propertyChangeIdsFor(
  documentId: string,
  properties: ReadProperty[],
  stored: StoredPropertyChangeIds,
): PropertyChangeIds {
  return Object.fromEntries(
    storedValueProperties(properties).map(({ definition }) => [
      definition.id,
      propertyChangeIdOf(stored, documentId, definition.id),
    ]),
  );
}

/**
 * Reads the change IDs of values a transaction has just written, from inside
 * that transaction: its writes still hold the rows, so each ID is the one its
 * own write produced. A read that returns values records change IDs from its
 * own value rows instead.
 */
export async function readWrittenPropertyChangeIds(
  tx: Db,
  documentIds: string[],
  propertyIds: string[],
): Promise<StoredPropertyChangeIds> {
  const stored: StoredPropertyChangeIds = new Map();
  if (!documentIds.length || !propertyIds.length) return stored;
  const values = schema.documentPropertyValues;
  return recordPropertyChangeIds(
    stored,
    await tx
      .select({
        documentId: values.documentId,
        propertyId: values.propertyId,
        generation: values.generation,
      })
      .from(values)
      .where(
        and(
          inArray(values.documentId, [...new Set(documentIds)]),
          inArray(values.propertyId, [...new Set(propertyIds)]),
        ),
      ),
  );
}

/**
 * Locks the named values on each page and lists the ones whose generation no
 * longer matches what the caller read.
 */
export async function propertyGenerationConflicts(
  tx: Db,
  expectations: Array<{ documentId: string; expected?: PropertyGenerations }>,
): Promise<Map<string, PropertyGenerationConflict[]>> {
  const guarded = expectations.filter(
    (entry) => entry.expected && Object.keys(entry.expected).length > 0,
  );
  const conflicts = new Map<string, PropertyGenerationConflict[]>();
  if (!guarded.length) return conflicts;
  const current = await readPropertyGenerations(
    tx,
    guarded.map((entry) => entry.documentId),
    {
      propertyIds: guarded.flatMap((entry) => Object.keys(entry.expected!)),
      lock: true,
    },
  );
  for (const { documentId, expected } of guarded) {
    const found = Object.entries(expected!)
      .map(([propertyId, generation]) => ({
        propertyId,
        expected: generation,
        current: current.of(documentId, propertyId),
      }))
      .filter((entry) => entry.expected !== entry.current);
    if (found.length) conflicts.set(documentId, found);
  }
  return conflicts;
}

export function propertyGenerationConflictError(
  details: Record<string, unknown>,
): ActionContractError {
  return new ActionContractError(
    "A property changed after it was read, so nothing was written. Read it again and decide from its current value.",
    {
      errorCode: "PROPERTY_GENERATION_CONFLICT",
      details,
      statusCode: 409,
    },
  );
}

/** Rejects the write when any named value on the page has moved on. */
export async function assertPropertyGenerations(
  tx: Db,
  documentId: string,
  expected: PropertyGenerations | undefined,
): Promise<void> {
  const conflicts = await propertyGenerationConflicts(tx, [
    { documentId, expected },
  ]);
  const found = conflicts.get(documentId);
  if (found)
    throw propertyGenerationConflictError({ documentId, conflicts: found });
}

export const expectedPropertyGenerationsSchema = z
  .record(z.string(), z.number().int().nonnegative())
  .optional()
  .describe(
    "Write only if each named property's generation still equals this one, from the item's propertyGenerations in get-content-database. A mismatch writes nothing and fails with PROPERTY_GENERATION_CONFLICT. Use it to act on a value only while it is still the one you read.",
  );
