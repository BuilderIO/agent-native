import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import {
  designSourceMutationLockKey,
  lockDesignFilesTable,
} from "../source-workspace.js";

const DEFAULT_MAX_ATTEMPTS = 8;
const CONFLICT_BACKOFF_MS = 8;
const designDataLocks = new Map<string, Promise<unknown>>();

export type DesignDataRecord = Record<string, unknown>;
export type DesignDataMutationTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

export interface DesignFileContentMutation {
  fileId: string;
  content: string;
}

export interface DesignFileContentSnapshot {
  id: string;
  content: string;
  fileType: string;
  updatedAt: string | null;
}

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
      ? typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : ""
      : "";
  return code === "40001" || code === "40P01";
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

interface MutateDesignDataOptions<TTransactionResult = undefined> {
  designId: string;
  mutate: (
    current: DesignDataRecord,
    context: { updatedAt: string },
  ) => DesignDataRecord;
  isApplied: (persisted: DesignDataRecord) => boolean;
  mutateFiles?: (
    current: DesignDataRecord,
    next: DesignDataRecord,
    context: {
      updatedAt: string;
      files: readonly DesignFileContentSnapshot[];
    },
  ) => readonly DesignFileContentMutation[];
  mutateInTransaction?: (
    tx: DesignDataMutationTransaction,
    current: DesignDataRecord,
    next: DesignDataRecord,
    context: { updatedAt: string },
  ) => Promise<TTransactionResult>;
  afterCommit?: (
    transactionResult: TTransactionResult | undefined,
  ) => Promise<void>;
  lockSourceMutation?: boolean;
  maxAttempts?: number;
  now?: () => Date;
}

async function mutateDesignDataUnlocked<TTransactionResult>({
  designId,
  mutate,
  isApplied,
  mutateFiles,
  mutateInTransaction,
  afterCommit,
  lockSourceMutation = false,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  now = () => new Date(),
}: MutateDesignDataOptions<TTransactionResult>): Promise<{
  data: DesignDataRecord;
  updatedAt: string;
  updatedFiles: Array<{
    id: string;
    content: string;
    previousContent: string;
  }>;
}> {
  await assertAccess("design", designId, "editor");
  const db = getDb();

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let committed:
      | {
          data: DesignDataRecord;
          updatedAt: string;
          transactionResult: TTransactionResult | undefined;
          updatedFiles: Array<{
            id: string;
            content: string;
            previousContent: string;
          }>;
        }
      | undefined;

    try {
      committed = await db.transaction(async (tx) => {
        if (mutateFiles || lockSourceMutation) {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${designSourceMutationLockKey(designId)}, 0::bigint))`,
          );
        }
        if (mutateFiles) {
          // Keep the design-data CAS and HTML rewrites in one transaction.
          // ponytail: reuse the existing design-file lock; split by design only
          // if breakpoint edits become a measurable multi-tenant bottleneck.
          await lockDesignFilesTable(tx);
        }

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

        const currentTime = now();
        const updatedAt = nextUpdatedAt(currentRow.updatedAt, currentTime);
        const currentData = parseDesignData(designId, currentRow.data);
        const nextData = mutate(currentData, { updatedAt });
        const nextSerialized = serializeDesignData(designId, nextData);
        const currentFiles = mutateFiles
          ? await tx
              .select({
                id: schema.designFiles.id,
                content: schema.designFiles.content,
                fileType: schema.designFiles.fileType,
                updatedAt: schema.designFiles.updatedAt,
              })
              .from(schema.designFiles)
              .where(eq(schema.designFiles.designId, designId))
              .for("update")
          : [];
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

        const updatedFiles: Array<{
          id: string;
          content: string;
          previousContent: string;
        }> = [];
        if (mutateFiles) {
          const fileMutations = mutateFiles(currentData, nextData, {
            updatedAt,
            files: currentFiles,
          });
          const seenFileIds = new Set<string>();
          const filesById = new Map(
            currentFiles.map((file) => [file.id, file]),
          );
          for (const mutation of fileMutations) {
            if (seenFileIds.has(mutation.fileId)) {
              throw new Error(
                `Duplicate design file mutation: ${mutation.fileId}`,
              );
            }
            seenFileIds.add(mutation.fileId);
            const file = filesById.get(mutation.fileId);
            if (!file) {
              throw new Error(
                `Design file mutation does not belong to design ${designId}: ${mutation.fileId}`,
              );
            }
            if (file.content === mutation.content) continue;
            const fileUpdatedAt = nextUpdatedAt(file.updatedAt, currentTime);
            await tx
              .update(schema.designFiles)
              .set({
                content: mutation.content,
                updatedAt: fileUpdatedAt,
                contentOperationSource: null,
                contentOperationRevision: null,
                contentOperationResultHash: null,
              })
              .where(
                and(
                  eq(schema.designFiles.id, file.id),
                  eq(schema.designFiles.designId, designId),
                  eq(schema.designFiles.content, file.content),
                  file.updatedAt === null
                    ? isNull(schema.designFiles.updatedAt)
                    : eq(schema.designFiles.updatedAt, file.updatedAt),
                ),
              );
            const [confirmedFile] = await tx
              .select({
                content: schema.designFiles.content,
                updatedAt: schema.designFiles.updatedAt,
              })
              .from(schema.designFiles)
              .where(eq(schema.designFiles.id, file.id))
              .limit(1);
            if (
              !confirmedFile ||
              confirmedFile.content !== mutation.content ||
              confirmedFile.updatedAt !== fileUpdatedAt
            ) {
              throw new DesignDataMutationConflictError(designId, attempt + 1);
            }
            updatedFiles.push({
              id: file.id,
              content: mutation.content,
              previousContent: file.content,
            });
          }
        }

        const transactionResult = mutateInTransaction
          ? await mutateInTransaction(tx, currentData, nextData, { updatedAt })
          : undefined;

        return { data: nextData, updatedAt, transactionResult, updatedFiles };
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
      await afterCommit?.(committed.transactionResult);
      const [persistedRow] = await db
        .select({ data: schema.designs.data })
        .from(schema.designs)
        .where(eq(schema.designs.id, designId));
      if (!persistedRow) {
        throw new Error(`Design "${designId}" not found after commit.`);
      }
      const persistedData = parseDesignData(designId, persistedRow.data);
      if (isApplied(persistedData)) {
        return {
          data: persistedData,
          updatedAt: committed.updatedAt,
          updatedFiles: committed.updatedFiles,
        };
      }
    }

    if (attempt < maxAttempts - 1) await conflictDelay(attempt);
  }

  throw new DesignDataMutationConflictError(designId, maxAttempts);
}

export function mutateDesignData<TTransactionResult = undefined>(
  options: MutateDesignDataOptions<TTransactionResult>,
): Promise<{
  data: DesignDataRecord;
  updatedAt: string;
  updatedFiles: Array<{
    id: string;
    content: string;
    previousContent: string;
  }>;
}> {
  return withDesignDataLock(options.designId, () =>
    mutateDesignDataUnlocked(options),
  );
}
