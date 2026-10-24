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
 * A property's generation goes up on every committed change to it, A → B → A
 * included, so a writer can tell "still the value I read" from "changed, then
 * changed back". Database triggers stamp it from one shared sequence, so
 * compare generations for equality only: the steps between them are not +1.
 *
 * It is the larger of the value row's own generation and the page's deletion
 * generation, which goes up whenever any value on the page is deleted. A
 * deleted value takes its own generation with it, so without the page's, a
 * property that was empty, then filled, then cleared would read 0 again and an
 * old token would pass. A deletion can make other properties on the page
 * conflict once; it never lets a stale write through. A value that hasn't
 * changed since generations began, on a page with no deletions, is 0.
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
 * Reads the generations of these pages' properties. `lock` holds the value
 * rows and the pages' deletion rows until the transaction ends, so a guarded
 * write can compare and write without another writer in between.
 *
 * A read that returns values alongside generations must read generations
 * first. A change that lands between the two reads then shows the newer value
 * with the older generation, which only makes the next guarded write conflict
 * and reread. The other order would pair an older value with a newer
 * generation and let a write based on the stale value through.
 */
export async function readPropertyGenerations(
  db: Db,
  documentIds: string[],
  options: { propertyIds?: string[]; lock?: boolean } = {},
): Promise<StoredPropertyGenerations> {
  const pageIds = [...new Set(documentIds)];
  const byValue = new Map<string, Map<string, number>>();
  const byPage = new Map<string, number>();
  const stored: StoredPropertyGenerations = {
    of: (documentId, propertyId) =>
      Math.max(
        byValue.get(documentId)?.get(propertyId) ?? 0,
        byPage.get(documentId) ?? 0,
      ),
  };
  if (!pageIds.length || options.propertyIds?.length === 0) return stored;
  const values = schema.documentPropertyValues;
  const valueQuery = db
    .select({
      documentId: values.documentId,
      propertyId: values.propertyId,
      generation: values.generation,
    })
    .from(values)
    .where(
      and(
        inArray(values.documentId, pageIds),
        options.propertyIds
          ? inArray(values.propertyId, [...new Set(options.propertyIds)])
          : undefined,
      ),
    );
  const deletions = schema.documentPropertyValueDeletions;
  const deletionQuery = db
    .select({
      documentId: deletions.documentId,
      generation: deletions.generation,
    })
    .from(deletions)
    .where(inArray(deletions.documentId, pageIds));
  const valueRows = options.lock
    ? await valueQuery.for("update")
    : await valueQuery;
  const deletionRows = options.lock
    ? await deletionQuery.for("update")
    : await deletionQuery;
  for (const row of valueRows) {
    const forPage = byValue.get(row.documentId) ?? new Map<string, number>();
    forPage.set(
      row.propertyId,
      Math.max(
        forPage.get(row.propertyId) ?? 0,
        generationNumber(row.generation),
      ),
    );
    byValue.set(row.documentId, forPage);
  }
  for (const row of deletionRows) {
    byPage.set(row.documentId, generationNumber(row.generation));
  }
  return stored;
}

/**
 * One generation for each property a read returns, including ones with no
 * value yet, so a caller can guard a write to an empty property too. Blocks
 * and computed fields take no guarded writes, so they're left out.
 */
export function propertyGenerationsFor(
  documentId: string,
  properties: Array<{ definition: { id: string; type: DocumentPropertyType } }>,
  stored: StoredPropertyGenerations,
): PropertyGenerations {
  return Object.fromEntries(
    properties
      .filter(
        ({ definition }) =>
          !isBlocksPropertyType(definition.type) &&
          !isComputedPropertyType(definition.type),
      )
      .map(({ definition }) => [
        definition.id,
        stored.of(documentId, definition.id),
      ]),
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
