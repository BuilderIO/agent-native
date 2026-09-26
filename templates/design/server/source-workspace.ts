import { fail } from "@agent-native/core/action";
import {
  CollabBaseVersionConflictError,
  hasCollabState,
  getText,
  applyTextToYDoc,
  type PreparedYDocMutationLease,
  withPreparedYDocMutation,
} from "@agent-native/core/collab";
import { getDbExec, type DbExec } from "@agent-native/core/db";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { isBoardFile } from "../shared/board-file.js";
import { ensureCodeLayerNodeIdsInHtml } from "../shared/code-layer.js";
import { isStandaloneHttpUrl } from "../shared/html-content.js";
import {
  assertDesignHtmlEditIntegrity,
  isDesignHtmlIntegrityError,
} from "../shared/html-integrity.js";
import { assertLockedLayersPreserved } from "../shared/locked-layers.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";
import type { DesignSourceType } from "../shared/source-mode.js";
import {
  languageForSourcePath,
  normalizeInlineSourcePath,
  sourceContentHash,
} from "../shared/source-workspace.js";
import { getDb, schema } from "./db/index.js";
import "./db/index.js";

export interface SourceWorkspaceFile {
  id: string;
  designId: string;
  filename: string;
  fileType: string;
  content?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

const _writeLocks = new Map<string, Promise<void>>();

export function affectedRowCount(result: unknown): number | undefined {
  const candidate = result as
    | {
        rowsAffected?: unknown;
        affectedRows?: unknown;
        rowCount?: unknown;
        count?: unknown;
        changes?: unknown;
        meta?: { changes?: unknown };
      }
    | undefined;
  const value =
    candidate?.rowsAffected ??
    candidate?.affectedRows ??
    candidate?.rowCount ??
    candidate?.count ??
    candidate?.changes ??
    candidate?.meta?.changes;
  return typeof value === "number" ? value : undefined;
}

export async function lockDesignFilesTable(tx: unknown): Promise<void> {
  const execute = (tx as { execute?: unknown }).execute;
  if (typeof execute !== "function") {
    throw new Error("Design-file transactions must support SQL table locks.");
  }
  await (execute as (query: unknown) => Promise<unknown>).call(
    tx,
    sql`LOCK TABLE design_files IN SHARE ROW EXCLUSIVE MODE`,
  );
}

export async function withSourceFileWriteLock<T>(
  fileId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = _writeLocks.get(fileId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.catch(() => {}).then(() => current);
  _writeLocks.set(fileId, chained);

  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (_writeLocks.get(fileId) === chained) {
      _writeLocks.delete(fileId);
    }
  }
}

export function withPreparedSourceFileMutation<T>(
  fileId: string,
  requestSource: string | undefined,
  callback: (lease: PreparedYDocMutationLease) => Promise<T>,
): Promise<T> {
  return withSourceFileWriteLock(fileId, () =>
    withPreparedYDocMutation(fileId, requestSource, callback),
  );
}

export function designSourceMutationLockKey(designId: string): string {
  return `agent-native:design-source:${designId}`;
}

export async function lockDesignSourceMutation(
  tx: DbExec,
  designId: string,
): Promise<void> {
  await tx.execute({
    sql: "SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))",
    args: [designSourceMutationLockKey(designId)],
  });
}

type DesignSourceMutationTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

function drizzleSqlForDbExec(statement: Parameters<DbExec["execute"]>[0]) {
  const rawSql = typeof statement === "string" ? statement : statement.sql;
  const args = typeof statement === "string" ? [] : (statement.args ?? []);
  const parts = rawSql.split("?");
  if (parts.length !== args.length + 1) {
    throw new Error(
      "A transaction-bound source write received an unreadable SQL statement.",
    );
  }
  return sql.join(
    parts.flatMap((part, index) => [
      sql.raw(part),
      ...(index < args.length ? [sql.param(args[index])] : []),
    ]),
  );
}

function dbExecForDrizzleTransaction(
  transaction: DesignSourceMutationTransaction,
): DbExec {
  return {
    execute: async (statement) => {
      const result = await transaction.execute(drizzleSqlForDbExec(statement));
      const resultRecord = result as {
        rows?: unknown;
        rowsAffected?: unknown;
        affectedRows?: unknown;
        rowCount?: unknown;
        count?: unknown;
        changes?: unknown;
        meta?: { changes?: unknown };
      };
      return {
        rows: Array.isArray(result)
          ? result
          : Array.isArray(resultRecord.rows)
            ? resultRecord.rows
            : [],
        rowsAffected: affectedRowCount(result) ?? 0,
      };
    },
  };
}

const _designTransactionExecs = new WeakMap<object, DbExec>();

export function getDesignSourceMutationExec(transaction: object): DbExec {
  const exec = _designTransactionExecs.get(transaction);
  if (!exec) {
    throw new Error(
      "A source mutation attempted collaboration persistence outside its SQL transaction.",
    );
  }
  return exec;
}

export function withDesignSourceMutationTransaction<T>(
  designId: string,
  callback: (tx: DesignSourceMutationTransaction) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${designSourceMutationLockKey(designId)}, 0::bigint))`,
    );
    const transactionExec = dbExecForDrizzleTransaction(tx);
    _designTransactionExecs.set(tx, transactionExec);
    try {
      return await callback(tx);
    } finally {
      _designTransactionExecs.delete(tx);
    }
  });
}

export function withDesignSourceReadTransaction<T>(
  designId: string,
  callback: (tx: DesignSourceMutationTransaction) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${designSourceMutationLockKey(designId)}, 0::bigint))`,
    );
    return callback(tx);
  });
}

export interface SourceWorkspaceContext {
  designId: string;
  sourceType: DesignSourceType;
  canEdit: boolean;
  files: SourceWorkspaceFile[];
  boardFileId: string | null;
}

function parseDesignDataSourceType(value: unknown): DesignSourceType {
  return designSourceTypeFromData(value);
}

function parseDesignDataBoardFileId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const raw = (parsed as Record<string, unknown>).boardFileId;
      return typeof raw === "string" && raw.length > 0 ? raw : null;
    }
  } catch {
    // Invalid design data — no board file id available.
  }
  return null;
}

function roleCanEdit(role: unknown): boolean {
  return role === "owner" || role === "admin" || role === "editor";
}

export async function resolveSourceWorkspace(
  designId: string,
  options: { includeContent?: boolean; includeBoard?: boolean } = {},
): Promise<SourceWorkspaceContext> {
  const access = await resolveAccess("design", designId);
  if (!access) {
    fail("Design not found", { statusCode: 404, errorCode: "not_found" });
  }

  const db = getDb();
  const files = options.includeContent
    ? await db
        .select({
          id: schema.designFiles.id,
          designId: schema.designFiles.designId,
          filename: schema.designFiles.filename,
          fileType: schema.designFiles.fileType,
          content: schema.designFiles.content,
          createdAt: schema.designFiles.createdAt,
          updatedAt: schema.designFiles.updatedAt,
        })
        .from(schema.designFiles)
        .where(eq(schema.designFiles.designId, designId))
    : await db
        .select({
          id: schema.designFiles.id,
          designId: schema.designFiles.designId,
          filename: schema.designFiles.filename,
          fileType: schema.designFiles.fileType,
          createdAt: schema.designFiles.createdAt,
          updatedAt: schema.designFiles.updatedAt,
        })
        .from(schema.designFiles)
        .where(eq(schema.designFiles.designId, designId));

  const resourceData = (access.resource as { data?: unknown }).data;
  return {
    designId,
    sourceType: parseDesignDataSourceType(resourceData),
    canEdit: roleCanEdit(access.role),
    files: options.includeBoard
      ? files
      : files.filter((file) => !isBoardFile(file.filename)),
    boardFileId: parseDesignDataBoardFileId(resourceData),
  };
}

export function findSourceWorkspaceFile(
  files: SourceWorkspaceFile[],
  target: { fileId?: string; path?: string },
): SourceWorkspaceFile {
  const normalizedPath =
    target.path !== undefined ? normalizeInlineSourcePath(target.path) : null;
  const file = target.fileId
    ? files.find((candidate) => candidate.id === target.fileId)
    : files.find((candidate) => candidate.filename === normalizedPath);
  if (!file) {
    throw new Error(
      target.fileId
        ? `Source file id "${target.fileId}" not found.`
        : `Source file "${normalizedPath}" not found.`,
    );
  }
  return file;
}

export async function readLiveSourceFile(file: SourceWorkspaceFile): Promise<{
  content: string;
  versionHash: string;
  language: string;
  source: "collab" | "stored";
}> {
  let content = file.content ?? "";
  let source: "collab" | "stored" = "stored";
  try {
    if (await hasCollabState(file.id)) {
      const live = await getText(file.id, "content");
      if (typeof live !== "string") {
        throw new Error("Collaboration content was not text.");
      }
      content = live;
      source = "collab";
    }
  } catch {
    throw new SourceWorkspaceEditConflictError(
      "Could not verify a source file's live version. Re-read the design and retry.",
    );
  }
  return {
    content,
    versionHash: sourceContentHash(content),
    language: languageForSourcePath(file.filename),
    source,
  };
}

/**
 * A caller-supplied editor snapshot has two distinct identities:
 *
 * - `content` is the working copy the mutation must transform (it may contain
 *   unsaved local edits), while
 * - `expectedVersionHash` is the live source version that working copy is
 *   allowed to replace.
 *
 * Hashing `currentContent` for both roles creates a false conflict whenever a
 * local working copy is legitimately ahead of the persisted/live base. This
 * helper accepts that working copy only when its SQL revision still matches
 * and the live document is either the persisted base it was derived from or
 * the working copy itself (for callers that already published it to Yjs).
 * Any third live value is a genuine concurrent edit and fails closed. The
 * returned live hash must be passed to `writeInlineSourceFile`, whose
 * read-check-write lock closes the race after this preparation step.
 */
export class SourceWorkspaceEditConflictError extends Error {
  readonly statusCode = 409;

  constructor(
    message = "Source file changed since the editor snapshot was prepared.",
  ) {
    super(message);
    this.name = "SourceWorkspaceEditConflictError";
  }
}

export function readPreparedSourceText(
  lease: Pick<PreparedYDocMutationLease, "doc">,
): string {
  try {
    const content = lease.doc.getText("content").toString();
    if (typeof content !== "string") {
      throw new Error("Prepared collaboration content was not text.");
    }
    return content;
  } catch {
    throw new SourceWorkspaceEditConflictError(
      "Could not verify a source file's live version. Re-read the design and retry.",
    );
  }
}

export async function lockPreparedSourceCollaboration(
  transaction: DbExec,
  fileId: string,
  lease: Pick<PreparedYDocMutationLease, "baseVersion">,
): Promise<{ hasState: boolean; needsSeed: boolean }> {
  let result: { rows: unknown[] };
  try {
    result = (await transaction.execute({
      sql: "SELECT yjs_state, text_snapshot, version FROM _collab_docs WHERE doc_id = ? FOR UPDATE",
      args: [fileId],
    })) as { rows: unknown[] };
  } catch {
    throw new SourceWorkspaceEditConflictError(
      "Could not verify a source file's live version. Re-read the design and retry.",
    );
  }

  const row = result.rows[0] as
    | { yjs_state?: unknown; text_snapshot?: unknown; version?: unknown }
    | undefined;
  if (!row) {
    if (lease.baseVersion !== null) {
      throw new SourceWorkspaceEditConflictError(
        "The source file's live collaboration document changed while it was being read. Re-read the design and retry.",
      );
    }
    return { hasState: false, needsSeed: true };
  }

  const version = Number(row.version);
  if (
    typeof row.yjs_state !== "string" ||
    typeof row.text_snapshot !== "string" ||
    !Number.isSafeInteger(version) ||
    version !== lease.baseVersion
  ) {
    throw new SourceWorkspaceEditConflictError(
      "The source file's live collaboration document changed while it was being read. Re-read the design and retry.",
    );
  }

  const hasState = row.yjs_state.length > 0;
  return { hasState, needsSeed: !hasState };
}

export async function prepareInlineSourceEdit(args: {
  file: SourceWorkspaceFile;
  currentContent?: string;
  revision?: string;
}): Promise<{ content: string; expectedVersionHash: string }> {
  const live = await readLiveSourceFile(args.file);

  if (args.currentContent === undefined) {
    return {
      content: live.content,
      expectedVersionHash: live.versionHash,
    };
  }

  if (!args.revision) {
    throw new SourceWorkspaceEditConflictError(
      "A source revision is required with current editor content.",
    );
  }
  if (!args.file.updatedAt || args.revision !== args.file.updatedAt) {
    throw new SourceWorkspaceEditConflictError();
  }

  const persistedVersionHash = sourceContentHash(args.file.content ?? "");
  const workingVersionHash = sourceContentHash(args.currentContent);
  if (
    live.versionHash !== persistedVersionHash &&
    live.versionHash !== workingVersionHash
  ) {
    throw new SourceWorkspaceEditConflictError();
  }

  return {
    content: args.currentContent,
    expectedVersionHash: live.versionHash,
  };
}

export async function writeInlineSourceFile(args: {
  designId: string;
  file: SourceWorkspaceFile;
  content: string;
  expectedVersionHash?: string;
  /** A content-only identity migration verified against the live source. */
  identityOnly?: boolean;
  operationSource?: string;
  operationRevision?: number;
  allowUrlBackedTransition?: boolean;
}): Promise<{ versionHash: string; changed: boolean; updatedAt: string }> {
  return withPreparedSourceFileMutation(args.file.id, "agent", async (lease) =>
    withDesignSourceMutationTransaction(args.designId, async (tx) => {
      await assertAccess("design", args.designId, "editor");
      const [currentFile] = await tx
        .select({
          id: schema.designFiles.id,
          designId: schema.designFiles.designId,
          filename: schema.designFiles.filename,
          fileType: schema.designFiles.fileType,
          content: schema.designFiles.content,
          createdAt: schema.designFiles.createdAt,
          updatedAt: schema.designFiles.updatedAt,
          contentOperationSource: schema.designFiles.contentOperationSource,
          contentOperationRevision: schema.designFiles.contentOperationRevision,
          contentOperationResultHash:
            schema.designFiles.contentOperationResultHash,
        })
        .from(schema.designFiles)
        .where(eq(schema.designFiles.id, args.file.id))
        .limit(1);
      if (!currentFile || currentFile.designId !== args.designId) {
        throw new Error("Source file not found.");
      }
      let hasCollaborationState = false;
      try {
        hasCollaborationState = await hasCollabState(args.file.id);
      } catch {
        throw new SourceWorkspaceEditConflictError(
          "Could not verify a source file's live version. Re-read the design and retry.",
        );
      }
      const needsCollabSeed =
        !hasCollaborationState || lease.baseVersion === null;
      let liveContent = readPreparedSourceText(lease);
      if (needsCollabSeed) {
        liveContent = currentFile.content ?? "";
        applyTextToYDoc(lease.doc, "content", liveContent, "agent");
      }
      const current = {
        content: liveContent,
        versionHash: sourceContentHash(liveContent),
      };
      const validatePreparedNoop = async () => {
        const preparedCollaboration = await lockPreparedSourceCollaboration(
          getDesignSourceMutationExec(tx),
          args.file.id,
          lease,
        );
        if (!preparedCollaboration.needsSeed) return;
        if (!needsCollabSeed) {
          applyTextToYDoc(lease.doc, "content", current.content, "agent");
        }
        try {
          await lease.persist(getDesignSourceMutationExec(tx), current.content);
        } catch (error) {
          if (error instanceof CollabBaseVersionConflictError) {
            throw new SourceWorkspaceEditConflictError(
              "Source file changed while the edit was being applied. Re-read the design and retry.",
            );
          }
          throw error;
        }
      };
      const identityOnly = args.identityOnly === true;
      let identityOnlyOperationSource: string | undefined;
      let identityOnlyOperationRevision: number | undefined;
      const liveBaseHash = current.versionHash;

      if (
        args.expectedVersionHash &&
        !identityOnly &&
        args.expectedVersionHash !== current.versionHash
      ) {
        throw new SourceWorkspaceEditConflictError(
          "Source file changed since it was read. Re-read the file and retry.",
        );
      }

      if (identityOnly) {
        identityOnlyOperationSource = args.operationSource;
        identityOnlyOperationRevision = args.operationRevision;
        if (
          args.expectedVersionHash === undefined ||
          !identityOnlyOperationSource ||
          !Number.isSafeInteger(identityOnlyOperationRevision) ||
          (identityOnlyOperationRevision ?? 0) <= 0
        ) {
          throw new SourceWorkspaceEditConflictError(
            "An identity-only source write requires its source version and operation lineage.",
          );
        }
        if (
          currentFile.fileType !== "html" ||
          isStandaloneHttpUrl(current.content) ||
          isStandaloneHttpUrl(currentFile.content ?? "")
        ) {
          throw new SourceWorkspaceEditConflictError(
            "Identity-only publication is supported only for inline HTML files.",
          );
        }

        const canonicalLiveSource = ensureCodeLayerNodeIdsInHtml(
          current.content,
          { source: { kind: "design-file", fileId: args.file.id } },
        ).content;
        const canonicalSqlSource = ensureCodeLayerNodeIdsInHtml(
          currentFile.content ?? "",
          { source: { kind: "design-file", fileId: args.file.id } },
        ).content;
        if (args.content !== canonicalLiveSource) {
          throw new SourceWorkspaceEditConflictError(
            "Identity-only publication must contain exactly the source node identity annotations.",
          );
        }

        const candidateHash = sourceContentHash(args.content);
        const exactPersistedOperation =
          currentFile.content === args.content &&
          current.content === args.content &&
          currentFile.contentOperationSource === identityOnlyOperationSource &&
          currentFile.contentOperationRevision ===
            identityOnlyOperationRevision &&
          currentFile.contentOperationResultHash === candidateHash;
        if (exactPersistedOperation) {
          await validatePreparedNoop();
          return {
            versionHash: candidateHash,
            changed: false,
            updatedAt: currentFile.updatedAt ?? new Date().toISOString(),
          };
        }
        if (
          currentFile.contentOperationSource === identityOnlyOperationSource &&
          typeof currentFile.contentOperationRevision === "number" &&
          (identityOnlyOperationRevision ?? 0) <=
            currentFile.contentOperationRevision
        ) {
          throw new SourceWorkspaceEditConflictError(
            "A newer source operation was already accepted for this identity migration.",
          );
        }

        const rawSqlHash = sourceContentHash(currentFile.content ?? "");
        const expectedHashMatchesLive =
          args.expectedVersionHash === current.versionHash;
        const expectedHashMatchesPublishedPreimage =
          current.content === args.content &&
          args.expectedVersionHash === rawSqlHash &&
          canonicalSqlSource === args.content;
        const sqlContentIsSameSource =
          currentFile.content === current.content ||
          (current.content === args.content &&
            canonicalSqlSource === args.content);
        if (!expectedHashMatchesLive && !expectedHashMatchesPublishedPreimage) {
          throw new SourceWorkspaceEditConflictError(
            "Source file changed since the identity migration was prepared. Re-read the file and retry.",
          );
        }
        if (!sqlContentIsSameSource) {
          throw new SourceWorkspaceEditConflictError(
            "The SQL source and live document no longer share the identity migration base. Re-read the file and retry.",
          );
        }
      }

      const changed = args.content !== current.content;
      const updatedAt = new Date().toISOString();
      if (!changed && !identityOnly) {
        await validatePreparedNoop();
        return {
          versionHash: current.versionHash,
          changed: false,
          updatedAt: currentFile.updatedAt ?? updatedAt,
        };
      }

      if (!identityOnly)
        assertLockedLayersPreserved(current.content, args.content);
      const assertCandidateIntegrity = (candidate: string) => {
        if (identityOnly && candidate !== args.content) {
          throw new SourceWorkspaceEditConflictError(
            "A concurrent source edit prevented identity-only publication.",
          );
        }
        const isSourceModeTransition =
          args.allowUrlBackedTransition === true &&
          (isStandaloneHttpUrl(current.content) ||
            isStandaloneHttpUrl(candidate));
        assertDesignHtmlEditIntegrity({
          previousContent: isSourceModeTransition ? candidate : current.content,
          nextContent: candidate,
          fileType: currentFile.fileType ?? args.file.fileType ?? "html",
          filename: currentFile.filename ?? args.file.filename,
        });
      };
      assertCandidateIntegrity(args.content);

      const liveBeforeApply = readPreparedSourceText(lease);
      const expectedLiveHash = identityOnly
        ? liveBaseHash
        : args.expectedVersionHash;
      if (
        expectedLiveHash &&
        expectedLiveHash !== sourceContentHash(liveBeforeApply)
      ) {
        throw new SourceWorkspaceEditConflictError(
          "Source file changed since it was read. Re-read the file and retry.",
        );
      }
      if (liveBeforeApply !== args.content) {
        applyTextToYDoc(lease.doc, "content", args.content, "agent");
      }

      const authoritativeContent = readPreparedSourceText(lease);
      try {
        if (identityOnly && authoritativeContent !== args.content) {
          throw new SourceWorkspaceEditConflictError(
            "A concurrent source edit prevented identity-only publication.",
          );
        }
        const isSourceModeTransition =
          args.allowUrlBackedTransition === true &&
          (isStandaloneHttpUrl(current.content) ||
            isStandaloneHttpUrl(authoritativeContent));
        assertDesignHtmlEditIntegrity({
          previousContent: isSourceModeTransition
            ? authoritativeContent
            : current.content,
          nextContent: authoritativeContent,
          fileType: currentFile.fileType ?? args.file.fileType ?? "html",
        });
      } catch (error) {
        if (!isDesignHtmlIntegrityError(error)) throw error;
        throw new SourceWorkspaceEditConflictError(
          "Source file changed while the edit was being applied. Re-read the file and retry.",
        );
      }

      const identityLineageWhere = identityOnly
        ? [
            currentFile.contentOperationSource == null
              ? isNull(schema.designFiles.contentOperationSource)
              : eq(
                  schema.designFiles.contentOperationSource,
                  currentFile.contentOperationSource,
                ),
            currentFile.contentOperationRevision == null
              ? isNull(schema.designFiles.contentOperationRevision)
              : eq(
                  schema.designFiles.contentOperationRevision,
                  currentFile.contentOperationRevision,
                ),
            currentFile.contentOperationResultHash == null
              ? isNull(schema.designFiles.contentOperationResultHash)
              : eq(
                  schema.designFiles.contentOperationResultHash,
                  currentFile.contentOperationResultHash,
                ),
          ]
        : [];
      const updateResult = await tx
        .update(schema.designFiles)
        .set({
          content: authoritativeContent,
          updatedAt,
          contentOperationSource: identityOnly
            ? identityOnlyOperationSource
            : null,
          contentOperationRevision: identityOnly
            ? identityOnlyOperationRevision
            : null,
          contentOperationResultHash: identityOnly
            ? sourceContentHash(authoritativeContent)
            : null,
        })
        .where(
          and(
            eq(schema.designFiles.id, args.file.id),
            eq(schema.designFiles.designId, args.designId),
            eq(schema.designFiles.content, currentFile.content),
            currentFile.updatedAt === null
              ? isNull(schema.designFiles.updatedAt)
              : eq(schema.designFiles.updatedAt, currentFile.updatedAt),
            ...identityLineageWhere,
          ),
        );

      const affected = affectedRowCount(updateResult);
      let persisted = affected === 1;
      if (affected === undefined) {
        const [confirmed] = await tx
          .select({
            content: schema.designFiles.content,
            updatedAt: schema.designFiles.updatedAt,
            contentOperationSource: schema.designFiles.contentOperationSource,
            contentOperationRevision:
              schema.designFiles.contentOperationRevision,
            contentOperationResultHash:
              schema.designFiles.contentOperationResultHash,
          })
          .from(schema.designFiles)
          .where(eq(schema.designFiles.id, args.file.id))
          .limit(1);
        persisted =
          confirmed?.content === authoritativeContent &&
          confirmed.updatedAt === updatedAt &&
          confirmed.contentOperationSource ===
            (identityOnly ? identityOnlyOperationSource : null) &&
          confirmed.contentOperationRevision ===
            (identityOnly ? identityOnlyOperationRevision : null) &&
          confirmed.contentOperationResultHash ===
            (identityOnly ? sourceContentHash(authoritativeContent) : null);
      }

      if (!persisted) {
        throw new SourceWorkspaceEditConflictError(
          "Source file changed while it was being saved. Re-read the file and retry.",
        );
      }

      try {
        await lease.persist(
          getDesignSourceMutationExec(tx),
          authoritativeContent,
        );
      } catch (error) {
        if (error instanceof CollabBaseVersionConflictError) {
          throw new SourceWorkspaceEditConflictError(
            "Source file changed while the edit was being applied. Re-read the file and retry.",
          );
        }
        throw error;
      }

      await tx
        .update(schema.designs)
        .set({ updatedAt })
        .where(eq(schema.designs.id, args.designId));

      return {
        versionHash: sourceContentHash(authoritativeContent),
        changed: authoritativeContent !== current.content,
        updatedAt,
      };
    }),
  );
}

export type InlineSourceBatchCollaborationFileStatus = {
  fileId: string;
  status: "synced";
};

export async function writeInlineSourceFilesBatch(args: {
  designId: string;
  files: Array<{
    file: SourceWorkspaceFile;
    content: string;
    expectedVersionHash: string;
  }>;
  expectedHtmlFileIds?: readonly string[];
  afterFilesPersist?: (tx: DbExec, updatedAt: string) => Promise<void>;
}): Promise<{
  files: Array<{
    id: string;
    versionHash: string;
    changed: boolean;
    updatedAt: string;
  }>;
  collaboration: {
    status: "synced";
    files: InlineSourceBatchCollaborationFileStatus[];
  };
}> {
  if (args.files.length === 0) {
    throw new Error("At least one source file is required.");
  }
  const ids = args.files.map(({ file }) => file.id);
  if (
    ids.some((id) => !id) ||
    new Set(ids).size !== ids.length ||
    args.files.some(
      ({ file, expectedVersionHash }) =>
        file.designId !== args.designId || !expectedVersionHash,
    )
  ) {
    throw new SourceWorkspaceEditConflictError(
      "The source batch contains an invalid or duplicate file identity.",
    );
  }
  if (
    args.expectedHtmlFileIds !== undefined &&
    (!Array.isArray(args.expectedHtmlFileIds) ||
      args.expectedHtmlFileIds.length === 0 ||
      args.expectedHtmlFileIds.some(
        (id) => typeof id !== "string" || id.trim().length === 0,
      ) ||
      new Set(args.expectedHtmlFileIds).size !==
        args.expectedHtmlFileIds.length)
  ) {
    throw new SourceWorkspaceEditConflictError(
      "The expected HTML source file set contains an invalid or duplicate file identity.",
    );
  }

  const sortedIds = [...ids].sort();
  const withLocks = async <T>(
    index: number,
    work: () => Promise<T>,
  ): Promise<T> => {
    if (index >= sortedIds.length) return work();
    return withSourceFileWriteLock(sortedIds[index]!, () =>
      withLocks(index + 1, work),
    );
  };

  return withLocks(0, async () => {
    const access = await assertAccess("design", args.designId, "editor");
    if (
      parseDesignDataSourceType(
        (access.resource as { data?: unknown }).data,
      ) !== "inline"
    ) {
      throw new SourceWorkspaceEditConflictError(
        "Atomic source batches are supported only for inline designs.",
      );
    }
    const db = getDb();
    const currentFiles = await db
      .select({
        id: schema.designFiles.id,
        designId: schema.designFiles.designId,
        filename: schema.designFiles.filename,
        fileType: schema.designFiles.fileType,
        content: schema.designFiles.content,
        updatedAt: schema.designFiles.updatedAt,
        contentOperationSource: schema.designFiles.contentOperationSource,
        contentOperationRevision: schema.designFiles.contentOperationRevision,
        contentOperationResultHash:
          schema.designFiles.contentOperationResultHash,
      })
      .from(schema.designFiles)
      .where(
        and(
          eq(schema.designFiles.designId, args.designId),
          inArray(schema.designFiles.id, ids),
        ),
      );
    const byId = new Map(currentFiles.map((file) => [file.id, file]));
    if (byId.size !== ids.length) {
      throw new SourceWorkspaceEditConflictError(
        "One or more source files are missing or no longer belong to this design.",
      );
    }

    const planned = await Promise.all(
      args.files.map(async ({ file, content, expectedVersionHash }) => {
        const currentFile = byId.get(file.id)!;
        const liveContent = (
          await readLiveSourceFile({
            ...currentFile,
            createdAt: null,
            updatedAt: currentFile.updatedAt ?? null,
          })
        ).content;
        if (
          sourceContentHash(currentFile.content ?? "") !==
            expectedVersionHash ||
          sourceContentHash(liveContent) !== expectedVersionHash
        ) {
          throw new SourceWorkspaceEditConflictError(
            "A source file's stored or live version changed since the batch was prepared. Save or refresh the design and retry.",
          );
        }
        assertLockedLayersPreserved(liveContent, content);
        assertDesignHtmlEditIntegrity({
          previousContent: liveContent,
          nextContent: content,
          fileType: currentFile.fileType ?? file.fileType ?? "html",
          filename: currentFile.filename ?? file.filename,
        });
        return { fileId: file.id, currentFile, liveContent, content };
      }),
    );

    const plannedById = new Map(planned.map((item) => [item.fileId, item]));
    const hasSqlChanges = planned.some(
      (item) => item.currentFile.content !== item.content,
    );
    const prepared: Array<{
      item: (typeof planned)[number];
      lease: PreparedYDocMutationLease;
    }> = [];

    const persistPrepared = async () => {
      const updatedAt = new Date().toISOString();
      const transaction = getDbExec().transaction;
      if (!transaction) {
        throw new Error(
          "The database does not support source batch transactions.",
        );
      }

      await transaction(async (tx) => {
        await lockDesignSourceMutation(tx, args.designId);
        if (args.expectedHtmlFileIds !== undefined) {
          const currentHtmlFiles = await tx.execute({
            sql: "SELECT id FROM design_files WHERE design_id = ? AND LOWER(file_type) = 'html' ORDER BY id FOR UPDATE",
            args: [args.designId],
          });
          const currentHtmlFileIds = currentHtmlFiles.rows.map((row) => {
            const id = (row as { id?: unknown }).id;
            if (typeof id !== "string" || id.length === 0) {
              throw new SourceWorkspaceEditConflictError(
                "The design's HTML source file set could not be verified. Refresh the design and retry.",
              );
            }
            return id;
          });
          const expectedHtmlFileIds = new Set(args.expectedHtmlFileIds);
          if (
            currentHtmlFileIds.length !== expectedHtmlFileIds.size ||
            currentHtmlFileIds.some((id) => !expectedHtmlFileIds.has(id))
          ) {
            throw new SourceWorkspaceEditConflictError(
              "The design's HTML source file set changed while the batch was being prepared. Refresh the design and retry.",
            );
          }
        }

        for (const { item, lease } of prepared) {
          const current = item.currentFile;
          const preparedCollaboration = await lockPreparedSourceCollaboration(
            tx,
            item.fileId,
            lease,
          );
          if (preparedCollaboration.needsSeed) {
            applyTextToYDoc(
              lease.doc,
              "content",
              current.content ?? "",
              "agent",
            );
          }
          const liveContent = readPreparedSourceText(lease);
          if (liveContent !== item.liveContent) {
            throw new SourceWorkspaceEditConflictError(
              "A source file changed while the batch was being prepared. Re-read the design and retry.",
            );
          }
          assertLockedLayersPreserved(liveContent, item.content);
          assertDesignHtmlEditIntegrity({
            previousContent: liveContent,
            nextContent: item.content,
            fileType: current.fileType ?? "html",
            filename: current.filename,
          });
          if (liveContent !== item.content) {
            applyTextToYDoc(lease.doc, "content", item.content, "agent");
          }
          const values = [
            item.fileId,
            args.designId,
            current.content ?? "",
            current.updatedAt,
            current.contentOperationSource,
            current.contentOperationRevision,
            current.contentOperationResultHash,
          ];
          const where = `id = ? AND design_id = ? AND content = ? AND updated_at IS NOT DISTINCT FROM ? AND content_operation_source IS NOT DISTINCT FROM ? AND content_operation_revision IS NOT DISTINCT FROM ? AND content_operation_result_hash IS NOT DISTINCT FROM ?`;

          if (current.content !== item.content) {
            const updated = await tx.execute({
              sql: `UPDATE design_files SET content = ?, content_operation_source = NULL, content_operation_revision = NULL, content_operation_result_hash = NULL, updated_at = ? WHERE ${where} RETURNING id`,
              args: [item.content, updatedAt, ...values],
            });
            if (updated.rows.length !== 1) {
              throw new SourceWorkspaceEditConflictError(
                "A source file changed while the batch was being saved. Re-read the design and retry.",
              );
            }
          } else {
            const currentRow = await tx.execute({
              sql: `SELECT id FROM design_files WHERE ${where} FOR UPDATE`,
              args: values,
            });
            if (currentRow.rows.length !== 1) {
              throw new SourceWorkspaceEditConflictError(
                "A source file changed while the batch was being saved. Re-read the design and retry.",
              );
            }
          }

          await lease.persist(tx, item.content);
        }

        if (args.afterFilesPersist) {
          await args.afterFilesPersist(tx, updatedAt);
        }

        if (hasSqlChanges) {
          const updatedDesign = await tx.execute({
            sql: "UPDATE designs SET updated_at = ? WHERE id = ? RETURNING id",
            args: [updatedAt, args.designId],
          });
          if (updatedDesign.rows.length !== 1) {
            throw new SourceWorkspaceEditConflictError(
              "The design changed while the source batch was being saved. Refresh and try again.",
            );
          }
        }
      });

      return updatedAt;
    };

    const withPrepared = async (index: number): Promise<string> => {
      if (index >= sortedIds.length) return persistPrepared();
      const item = plannedById.get(sortedIds[index]!)!;
      return withPreparedYDocMutation(item.fileId, "agent", async (lease) => {
        prepared.push({ item, lease });
        return withPrepared(index + 1);
      });
    };

    let updatedAt: string;
    try {
      updatedAt = await withPrepared(0);
    } catch (error) {
      if (error instanceof CollabBaseVersionConflictError) {
        throw new SourceWorkspaceEditConflictError(
          "A source file's live version changed while the batch was being saved. Re-read the design and retry.",
        );
      }
      throw error;
    }

    return {
      files: planned.map((item) => ({
        id: item.fileId,
        versionHash: sourceContentHash(item.content),
        changed: item.liveContent !== item.content,
        updatedAt:
          item.currentFile.content === item.content
            ? (item.currentFile.updatedAt ?? updatedAt)
            : updatedAt,
      })),
      collaboration: {
        status: "synced",
        files: planned.map((item) => ({
          fileId: item.fileId,
          status: "synced",
        })),
      },
    };
  });
}
