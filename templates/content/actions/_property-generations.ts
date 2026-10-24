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
 * A property value's generation goes up on every committed change to it,
 * A → B → A included, so a writer can tell "still the value I read" from
 * "changed, then changed back". A database trigger stamps it from one shared
 * sequence, so compare generations for equality only: the steps between them
 * are not +1. A value that has never changed since generations began reads as
 * 0, and a property with no stored value is 0 too.
 */
export type PropertyGenerations = Record<string, number>;

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
    throw new Error(
      `Stored property generation ${String(value)} is not an integer.`,
    );
  }
  return generation;
}

/**
 * Generations of every stored value on these pages, keyed by page then
 * property. `lock` holds the value rows until the transaction ends, so a
 * guarded write can compare and write without another writer in between.
 */
export async function readPropertyGenerations(
  db: Db,
  documentIds: string[],
  options: { propertyIds?: string[]; lock?: boolean } = {},
): Promise<Map<string, PropertyGenerations>> {
  const result = new Map<string, PropertyGenerations>();
  if (!documentIds.length || options.propertyIds?.length === 0) return result;
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
  const rows = options.lock ? await query.for("update") : await query;
  for (const row of rows) {
    const forDocument = result.get(row.documentId) ?? {};
    forDocument[row.propertyId] = Math.max(
      forDocument[row.propertyId] ?? 0,
      generationNumber(row.generation),
    );
    result.set(row.documentId, forDocument);
  }
  return result;
}

/**
 * One generation for each property a read returns, 0 where it has no value
 * yet, so a caller can guard a write to an empty property too. Blocks and
 * computed fields take no guarded writes, so they're left out.
 */
export function propertyGenerationsFor(
  properties: Array<{ definition: { id: string; type: DocumentPropertyType } }>,
  stored: PropertyGenerations | undefined,
): PropertyGenerations {
  return Object.fromEntries(
    properties
      .filter(
        ({ definition }) =>
          !isBlocksPropertyType(definition.type) &&
          !isComputedPropertyType(definition.type),
      )
      .map(({ definition }) => [definition.id, stored?.[definition.id] ?? 0]),
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
        current: current.get(documentId)?.[propertyId] ?? 0,
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
    "Write only if each named property's generation still equals this one, from the item's propertyGenerations in get-content-database (0 when the property has no value). A mismatch writes nothing and fails with PROPERTY_GENERATION_CONFLICT. Use it to act on a value only while it is still the one you read.",
  );
