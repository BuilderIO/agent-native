import {
  hasCollabState,
  getText,
  applyText,
  seedFromText,
} from "@agent-native/core/collab";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";

import { isBoardFile } from "../shared/board-file.js";
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
import "./db/index.js"; // ensure registerShareableResource runs

export interface SourceWorkspaceFile {
  id: string;
  designId: string;
  filename: string;
  fileType: string;
  content?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// Per-file in-process write serialization for writeInlineSourceFile's full
// read-check-write critical section.
//
// @agent-native/core/collab's applyText/seedFromText each serialize their OWN
// Y.Doc mutation via an internal per-docId lock, but that only protects the
// CRDT mutation itself — not the read-then-decide-then-write sequence around
// it. Two concurrent writers to a file that has NO collab doc yet (a real
// case: doc creation is lazy, so nothing has opened this file in a live
// session) can each observe hasCollabState()===false, so BOTH take the
// seedFromText branch — which only takes effect for the first caller to
// reach it — and, without this lock, both then proceed to persist their own
// content, silently discarding whichever writer didn't "win" the seed (a
// lost update, not a CRDT merge — reproduced in
// insert-design-native-asset.interleave.spec.ts). Serializing the whole
// critical section per file id closes this: the second writer's read
// (hasCollabState / getText / expectedVersionHash check) now happens AFTER
// the first writer's collab mutation has landed, so it observes the true
// current state and either converges its own diff cleanly or is rejected by
// the expectedVersionHash guard — never silently clobbered.
const _writeLocks = new Map<string, Promise<void>>();

/**
 * Normalize affected-row metadata from every createGetDb backend: libSQL,
 * PGlite, Neon, postgres.js, better-sqlite3, and D1.
 */
function affectedRowCount(result: unknown): number | undefined {
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

// Exported so other write paths touching the same per-file critical section
// (content read -> optimistic-concurrency hash check -> collab/SQL write) can
// serialize under the SAME lock instead of each guarding independently. Two
// callers can each pass their own hash check against a live read that's still
// valid at check time, then both proceed to write — the check alone doesn't
// prevent the interleave, only serializing the whole read-check-write section
// per file id does. See actions/update-file.ts's content-write path.
//
// `_writeLocks` is intentionally only a fast in-process serialization layer.
// Cross-process correctness comes from the content + updatedAt SQL CAS in
// writeInlineSourceFile (and the operation-lineage CAS in update-file): a
// different instance that commits first makes the losing update affect zero
// rows, so it is rejected instead of overwriting the winner.
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

export interface SourceWorkspaceContext {
  designId: string;
  sourceType: DesignSourceType;
  canEdit: boolean;
  files: SourceWorkspaceFile[];
  /**
   * The design's reserved board overlay file id (designs.data.boardFileId),
   * when one has been created. The board file is deliberately excluded from
   * `files` above (see isBoardFile filter below) since it isn't a source
   * file the code workbench edits — callers that need to recognize "this id
   * is the board, not a missing file" (e.g. read-source-file's graceful
   * no-op) should check against this instead of treating an unresolved id
   * as an error.
   */
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
  options: { includeContent?: boolean } = {},
): Promise<SourceWorkspaceContext> {
  const access = await resolveAccess("design", designId);
  if (!access) throw new Error("Design not found");

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
    files: files.filter((file) => !isBoardFile(file.filename)),
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
}> {
  let content = file.content ?? "";
  try {
    if (await hasCollabState(file.id)) {
      const live = await getText(file.id, "content");
      if (typeof live === "string") content = live;
    }
  } catch {
    // Collab reads are best-effort; SQL content is the fallback.
  }
  return {
    content,
    versionHash: sourceContentHash(content),
    language: languageForSourcePath(file.filename),
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
  constructor(
    message = "Source file changed since the editor snapshot was prepared.",
  ) {
    super(message);
    this.name = "SourceWorkspaceEditConflictError";
  }
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
}): Promise<{ versionHash: string; changed: boolean; updatedAt: string }> {
  return withSourceFileWriteLock(args.file.id, async () => {
    await assertAccess("design", args.designId, "editor");
    const db = getDb();
    const [currentFile] = await db
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
      .where(eq(schema.designFiles.id, args.file.id))
      .limit(1);
    if (!currentFile || currentFile.designId !== args.designId) {
      throw new Error("Source file not found.");
    }
    const current = await readLiveSourceFile(currentFile);
    if (
      args.expectedVersionHash &&
      args.expectedVersionHash !== current.versionHash
    ) {
      throw new Error(
        "Source file changed since it was read. Re-read the file and retry.",
      );
    }

    const changed = args.content !== current.content;
    const updatedAt = new Date().toISOString();
    if (!changed) {
      return {
        versionHash: current.versionHash,
        changed: false,
        updatedAt: currentFile.updatedAt ?? updatedAt,
      };
    }

    if (
      currentFile.fileType === "html" ||
      currentFile.fileType === "jsx" ||
      current.content.includes("data-agent-native-locked")
    ) {
      assertLockedLayersPreserved(current.content, args.content);
    }
    assertDesignHtmlEditIntegrity({
      previousContent: current.content,
      nextContent: args.content,
      fileType: currentFile.fileType ?? args.file.fileType ?? "html",
    });

    if (await hasCollabState(args.file.id)) {
      const liveBeforeApply = await getText(args.file.id, "content");
      if (
        args.expectedVersionHash &&
        args.expectedVersionHash !== sourceContentHash(liveBeforeApply)
      ) {
        throw new Error(
          "Source file changed since it was read. Re-read the file and retry.",
        );
      }
      if (liveBeforeApply !== args.content) {
        try {
          await applyText(args.file.id, args.content, "content", "agent", {
            // A human artboard edit can reach the shared Y.Doc from another
            // serverless process after the version check above. Validate the
            // fully converged CRDT snapshot before core persists or broadcasts
            // the agent diff so clients never observe a malformed intermediate
            // document that is immediately rolled back below.
            validateSnapshot: (snapshot) =>
              assertDesignHtmlEditIntegrity({
                previousContent: current.content,
                nextContent: snapshot,
                fileType: currentFile.fileType ?? args.file.fileType ?? "html",
              }),
          });
        } catch (error) {
          if (!isDesignHtmlIntegrityError(error)) throw error;
          // The caller's candidate already passed the integrity check above.
          // A failure here therefore came from concurrent CRDT convergence,
          // so surface it as a retryable conflict instead of blaming the edit
          // with the invalid-HTML toast.
          throw new SourceWorkspaceEditConflictError(
            "Source file changed while the edit was being applied. Re-read the file and retry.",
          );
        }
      }
    } else {
      // No collab doc exists for this file yet. Without the write-lock this
      // function is now wrapped in, two concurrent callers could both
      // observe hasCollabState()===false (doc creation is lazy) and both
      // reach seedFromText — which only takes effect for the first caller —
      // so a naive unconditional SQL write after this branch could clobber
      // whichever writer "won" the seed with a loser's stale content (a lost
      // update, not merely a no-op: exactly the "assets disappear/reappear"
      // bug this fix closes). The lock serializes this whole critical
      // section per file id, so by the time a second call reaches this
      // branch it already observes hasCollabState()===true from the first
      // call's seed and takes the applyText branch instead.
      await seedFromText(args.file.id, args.content);
    }

    // Persist whatever the collab layer actually holds now, not the caller's
    // args.content blindly — normally the same string, but this keeps SQL a
    // true mirror of the converged live document under the lock rather than
    // trusting args.content directly.
    const authoritativeContent = await getText(args.file.id, "content");
    try {
      assertDesignHtmlEditIntegrity({
        previousContent: current.content,
        nextContent: authoritativeContent,
        fileType: currentFile.fileType ?? args.file.fileType ?? "html",
      });
    } catch (error) {
      // `applyText` is a full-target diff, but keep the write transaction
      // fail-closed even if a malformed/concurrent collab state somehow
      // converges to something other than the validated candidate. Restore
      // the exact pre-write live content before SQL can observe corruption.
      await applyText(args.file.id, current.content, "content", "agent");
      throw error;
    }

    // The JS lock is process-local. Guard the SQL mirror with the exact
    // content + revision read above so a writer on another instance cannot
    // commit between our read/live-doc mutation and this final persistence.
    const updateResult = await db
      .update(schema.designFiles)
      .set({
        content: authoritativeContent,
        updatedAt,
        // This action/agent write is outside the browser save sequence. Break
        // that lineage so a later tab revision must pass its ordinary content
        // hash guard instead of inheriting a stale same-source bypass.
        contentOperationSource: null,
        contentOperationRevision: null,
        contentOperationResultHash: null,
      })
      .where(
        and(
          eq(schema.designFiles.id, args.file.id),
          eq(schema.designFiles.designId, args.designId),
          eq(schema.designFiles.content, currentFile.content),
          currentFile.updatedAt === null
            ? isNull(schema.designFiles.updatedAt)
            : eq(schema.designFiles.updatedAt, currentFile.updatedAt),
        ),
      );

    const affected = affectedRowCount(updateResult);
    let persisted = affected === 1;
    if (affected === undefined) {
      const [confirmed] = await db
        .select({
          content: schema.designFiles.content,
          updatedAt: schema.designFiles.updatedAt,
        })
        .from(schema.designFiles)
        .where(eq(schema.designFiles.id, args.file.id))
        .limit(1);
      persisted =
        confirmed?.content === authoritativeContent &&
        confirmed.updatedAt === updatedAt;
    }

    if (!persisted) {
      const [winner] = await db
        .select({ content: schema.designFiles.content })
        .from(schema.designFiles)
        .where(eq(schema.designFiles.id, args.file.id))
        .limit(1);
      if (winner && winner.content !== authoritativeContent) {
        await applyText(args.file.id, winner.content, "content", "agent");
      }
      throw new SourceWorkspaceEditConflictError(
        "Source file changed while it was being saved. Re-read the file and retry.",
      );
    }

    await db
      .update(schema.designs)
      .set({ updatedAt })
      .where(eq(schema.designs.id, args.designId));

    return {
      versionHash: sourceContentHash(authoritativeContent),
      changed: authoritativeContent !== current.content,
      updatedAt,
    };
  });
}
