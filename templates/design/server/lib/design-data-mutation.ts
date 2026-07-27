import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

const DEFAULT_MAX_ATTEMPTS = 8;
const CONFLICT_BACKOFF_MS = 8;
const designDataLocks = new Map<string, Promise<unknown>>();

export type DesignDataRecord = Record<string, unknown>;

export class DesignDataMutationConflictError extends Error {
  constructor(designId: string, attempts: number) {
    super(
      `Failed to update design "${designId}" after ${attempts} concurrent write conflicts. Please retry.`,
    );
    this.name = "DesignDataMutationConflictError";
  }
}

export class InvalidDesignDataError extends Error {
  constructor(designId: string) {
    super(
      `Design "${designId}" has invalid data JSON. Refusing to overwrite it; repair or restore the design data before retrying.`,
    );
    this.name = "InvalidDesignDataError";
  }
}

function parseDesignData(
  designId: string,
  serialized: string | null,
): DesignDataRecord {
  // A small number of legacy rows predate the current NOT NULL schema. Treat
  // SQL NULL as the old empty-data sentinel, while still refusing malformed
  // non-null JSON so a corrupt blob is never silently discarded.
  if (serialized === null) return {};
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as DesignDataRecord;
    }
  } catch {
    // The dedicated error below explains why the write is refused.
  }
  throw new InvalidDesignDataError(designId);
}

function serializeDesignData(designId: string, data: DesignDataRecord): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new InvalidDesignDataError(designId);
  }
  try {
    const serialized = JSON.stringify(data);
    if (typeof serialized === "string") return serialized;
  } catch {
    // The dedicated error below keeps circular/non-serializable transforms
    // from turning into a partial or ambiguous write.
  }
  throw new InvalidDesignDataError(designId);
}

function nextUpdatedAt(current: string | null, now: Date): string {
  const currentMs = current ? Date.parse(current) : Number.NaN;
  const nextMs = Number.isFinite(currentMs)
    ? Math.max(now.getTime(), currentMs + 1)
    : now.getTime();
  return new Date(nextMs).toISOString();
}

function conflictDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.min(64, CONFLICT_BACKOFF_MS * (attempt + 1)));
  });
}

function isRetryableTransactionConflict(error: unknown): boolean {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  return (
    code === "SQLITE_BUSY" ||
    code === "SQLITE_LOCKED" ||
    code === "40001" || // Postgres serialization failure
    code === "40P01" // Postgres deadlock detected
  );
}

function withDesignDataLock<T>(
  designId: string,
  callback: () => Promise<T>,
): Promise<T> {
  const previous = designDataLocks.get(designId) ?? Promise.resolve();
  const next = previous.then(callback, callback);
  designDataLocks.set(designId, next);
  const cleanup = () => {
    if (designDataLocks.get(designId) === next) {
      designDataLocks.delete(designId);
    }
  };
  next.then(cleanup, cleanup);
  return next;
}

interface MutateDesignDataOptions {
  designId: string;
  mutate: (
    current: DesignDataRecord,
    context: { updatedAt: string },
  ) => DesignDataRecord;
  /**
   * Proves the caller's intent is present in the committed row. This is
   * deliberately intent-based rather than whole-object equality: a sibling
   * writer may safely add unrelated keys immediately after our commit.
   */
  isApplied: (persisted: DesignDataRecord) => boolean;
  maxAttempts?: number;
  now?: () => Date;
}

/**
 * Atomically mutate the designs.data JSON record without losing sibling keys.
 *
 * The conditional UPDATE is portable Drizzle query-builder SQL (no RETURNING,
 * dialect-specific JSON operator, or driver result-shape assumption). The
 * read, compare-and-swap, and confirmation read live in one transaction. A
 * post-commit read then proves the requested intent survived before success is
 * reported. Explicit property deletion performed by `mutate` is preserved
 * because the complete transformed object is the CAS candidate.
 *
 * Isolation assumptions: local better-sqlite3 transactions use the framework's
 * BEGIN IMMEDIATE + top-level queue, so no sibling writer can enter between
 * the read and CAS. Postgres may let a sibling commit after the read, but its
 * conditional UPDATE is re-evaluated after the row-lock wait; the confirmation
 * read detects a lost CAS and triggers a retry. Other supported drivers get the
 * same guarded predicate plus confirmation/post-commit verification rather
 * than relying on a driver-specific affected-row result.
 */
async function mutateDesignDataUnlocked({
  designId,
  mutate,
  isApplied,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  now = () => new Date(),
}: MutateDesignDataOptions): Promise<{
  data: DesignDataRecord;
  updatedAt: string;
}> {
  // Re-assert at the shared write boundary. Callers also check before doing
  // parse/index work so unauthorized requests fail early, but this helper must
  // remain independently scoped if a new action adopts it later.
  await assertAccess("design", designId, "editor");
  const db = getDb();

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let committed: { data: DesignDataRecord; updatedAt: string } | undefined;

    try {
      committed = await db.transaction(async (tx) => {
        const [currentRow] = await tx
          .select({
            data: schema.designs.data,
            updatedAt: schema.designs.updatedAt,
          })
          .from(schema.designs)
          .where(eq(schema.designs.id, designId));

        if (!currentRow) {
          throw new Error(`Design "${designId}" not found.`);
        }

        const updatedAt = nextUpdatedAt(currentRow.updatedAt, now());
        const currentData = parseDesignData(designId, currentRow.data);
        const nextData = mutate(currentData, { updatedAt });
        const nextSerialized = serializeDesignData(designId, nextData);
        const revisionConditions = [
          eq(schema.designs.id, designId),
          currentRow.data === null
            ? isNull(schema.designs.data)
            : eq(schema.designs.data, currentRow.data),
        ];
        revisionConditions.push(
          currentRow.updatedAt === null
            ? isNull(schema.designs.updatedAt)
            : eq(schema.designs.updatedAt, currentRow.updatedAt),
        );

        await tx
          .update(schema.designs)
          .set({ data: nextSerialized, updatedAt })
          .where(and(...revisionConditions));

        // Avoid driver-specific rowsAffected/rowCount/RETURNING contracts.
        // Inside the same transaction the row remains locked after a winning
        // UPDATE, so exact equality proves this CAS attempt wrote its candidate.
        const [confirmed] = await tx
          .select({ data: schema.designs.data })
          .from(schema.designs)
          .where(eq(schema.designs.id, designId));

        if (!confirmed) {
          throw new Error(`Design "${designId}" not found after update.`);
        }
        if (confirmed.data !== nextSerialized) {
          throw new DesignDataMutationConflictError(designId, attempt + 1);
        }

        return { data: nextData, updatedAt };
      });
    } catch (error) {
      if (
        !(error instanceof DesignDataMutationConflictError) &&
        !isRetryableTransactionConflict(error)
      ) {
        throw error;
      }
    }

    if (committed) {
      const [persistedRow] = await db
        .select({ data: schema.designs.data })
        .from(schema.designs)
        .where(eq(schema.designs.id, designId));
      if (!persistedRow) {
        throw new Error(`Design "${designId}" not found after commit.`);
      }
      const persistedData = parseDesignData(designId, persistedRow.data);
      if (isApplied(persistedData)) {
        return { data: persistedData, updatedAt: committed.updatedAt };
      }
    }

    if (attempt < maxAttempts - 1) await conflictDelay(attempt);
  }

  throw new DesignDataMutationConflictError(designId, maxAttempts);
}

export function mutateDesignData(
  options: MutateDesignDataOptions,
): Promise<{ data: DesignDataRecord; updatedAt: string }> {
  // Serialize same-process calls before entering a backend transaction. This
  // avoids overlapping libSQL/SQLite transactions on one client; the CAS
  // remains necessary for multi-instance and cross-process writers.
  return withDesignDataLock(options.designId, () =>
    mutateDesignDataUnlocked(options),
  );
}
