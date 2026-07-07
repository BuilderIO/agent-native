import {
  hasCollabState,
  getText,
  applyText,
  seedFromText,
} from "@agent-native/core/collab";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";

import { isBoardFile } from "../shared/board-file.js";
import { normalizeDesignSourceType } from "../shared/source-mode.js";
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

// Exported so other write paths touching the same per-file critical section
// (content read -> optimistic-concurrency hash check -> collab/SQL write) can
// serialize under the SAME lock instead of each guarding independently. Two
// callers can each pass their own hash check against a live read that's still
// valid at check time, then both proceed to write — the check alone doesn't
// prevent the interleave, only serializing the whole read-check-write section
// per file id does. See actions/update-file.ts's content-write path.
//
// IN-PROCESS ONLY: `_writeLocks` is a plain JS `Map`, so this only serializes
// writes within a single Node.js process/worker. Multi-instance / horizontally
// scaled hosted deployments (several server processes/pods behind a load
// balancer) do NOT share this lock — two requests routed to DIFFERENT
// processes can still race past each other, since each process has its own
// independent `_writeLocks` Map. A real cross-process guard would need
// something like a Postgres/SQL advisory lock (e.g. `pg_advisory_lock`) or a
// distributed lock service, keyed by file id, shared across all instances.
// This is a known, tracked follow-up — not implemented here.
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
  if (typeof value !== "string") return "inline";
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const raw = (parsed as Record<string, unknown>).sourceType;
      return normalizeDesignSourceType(raw) ?? "inline";
    }
  } catch {
    // Invalid design data falls back to inline, matching existing actions.
  }
  return "inline";
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
        await applyText(args.file.id, args.content, "content", "agent");
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

    await db
      .update(schema.designFiles)
      .set({ content: authoritativeContent, updatedAt })
      .where(eq(schema.designFiles.id, args.file.id));

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
