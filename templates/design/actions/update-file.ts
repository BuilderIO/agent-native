import { defineAction } from "@agent-native/core/action";
import {
  CollabBaseVersionConflictError,
  applyTextToYDoc,
  hasCollabState,
  type PreparedYDocMutationLease,
} from "@agent-native/core/collab";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  checkpointSkippedResultField,
  snapshotDesignBeforeAgentEdit,
} from "../server/lib/design-versions.js";
import {
  affectedRowCount,
  getDesignSourceMutationExec,
  lockDesignFilesTable,
  readLiveSourceFile,
  readPreparedSourceText,
  SourceWorkspaceEditConflictError,
  withDesignSourceMutationTransaction,
  withPreparedSourceFileMutation,
  withSourceFileWriteLock,
  writeInlineSourceFile,
} from "../server/source-workspace.js";
import { assertDesignHtmlEditIntegrity } from "../shared/html-integrity.js";
import { assertLockedLayersPreserved } from "../shared/locked-layers.js";
import { sourceContentHash } from "../shared/source-workspace.js";

function logSaveConflictDebug(
  event: string,
  detail: Record<string, unknown>,
): void {
  console.warn(`[update-file:debug] ${event}`, detail);
}

function fileNotFound(id: string): Error & { statusCode?: number } {
  const err = new Error(`File not found: ${id}`) as Error & {
    statusCode?: number;
  };
  err.statusCode = 404;
  return err;
}

export default defineAction({
  description:
    "Update an existing file in a design project. " +
    "Only provided fields are updated; omitted fields are left unchanged. " +
    "Also updates the parent design's updatedAt timestamp.",
  schema: z
    .object({
      id: z.string().describe("File ID to update"),
      content: z.string().optional().describe("Updated file content"),
      filename: z.string().optional().describe("New filename"),
      fileType: z
        .enum(["html", "css", "jsx", "asset"])
        .optional()
        .describe("Updated file type"),
      syncCollab: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "Whether to mirror content updates into the live collaboration document.",
        ),
      identityOnly: z
        .boolean()
        .optional()
        .describe(
          "Accept only the server-verified source node identity annotations for the current HTML document.",
        ),
      expectedVersionHash: z
        .string()
        .optional()
        .describe(
          "Optional optimistic-concurrency guard for content updates: the " +
            "sourceContentHash of the live content this write was computed " +
            "from (same semantics as apply-source-edit / read-source-file). " +
            "When provided and the file changed since that read, the write " +
            "fails loud instead of silently merging a stale full document " +
            "into the collaboration state.",
        ),
      operationSource: z
        .string()
        .min(1)
        .max(256)
        .optional()
        .describe(
          "Stable client/tab id for monotonic content-save ordering. Must be paired with operationRevision.",
        ),
      operationRevision: z
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER)
        .optional()
        .describe(
          "Monotonic per-file revision allocated when the client queues the save. Must be paired with operationSource.",
        ),
    })
    .superRefine((value, ctx) => {
      if (
        (value.operationSource === undefined) !==
        (value.operationRevision === undefined)
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "operationSource and operationRevision must be provided together.",
          path:
            value.operationSource === undefined
              ? ["operationSource"]
              : ["operationRevision"],
        });
      }
      if (value.identityOnly === true) {
        if (value.content === undefined || !value.expectedVersionHash) {
          ctx.addIssue({
            code: "custom",
            message:
              "Identity-only updates require content and expectedVersionHash.",
            path:
              value.content === undefined
                ? ["content"]
                : ["expectedVersionHash"],
          });
        }
        if (
          value.filename !== undefined ||
          value.fileType !== undefined ||
          value.syncCollab === false
        ) {
          ctx.addIssue({
            code: "custom",
            message:
              "Identity-only updates cannot change file metadata or disable collaboration sync.",
            path: ["identityOnly"],
          });
        }
        if (
          value.operationSource === undefined ||
          value.operationRevision === undefined
        ) {
          ctx.addIssue({
            code: "custom",
            message:
              "Identity-only updates require operationSource and operationRevision.",
            path:
              value.operationSource === undefined
                ? ["operationSource"]
                : ["operationRevision"],
          });
        }
      }
    }),
  run: async (
    {
      id,
      content,
      filename,
      fileType,
      syncCollab,
      identityOnly,
      expectedVersionHash,
      operationSource,
      operationRevision,
    },
    context,
  ) => {
    if (
      filename &&
      (filename.includes("..") ||
        filename.includes("/") ||
        filename.includes("\\"))
    ) {
      throw new Error("Invalid filename: path traversal not allowed");
    }

    const db = getDb();
    const now = new Date().toISOString();

    const [file] = await db
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
      .innerJoin(
        schema.designs,
        eq(schema.designFiles.designId, schema.designs.id),
      )
      .where(
        and(
          eq(schema.designFiles.id, id),
          accessFilter(schema.designs, schema.designShares),
        ),
      )
      .limit(1);

    if (!file) {
      // The row is gone or out of access scope — retry can't succeed.
      throw fileNotFound(id);
    }

    await assertAccess("design", file.designId, "editor");
    const checkpoint = await snapshotDesignBeforeAgentEdit(
      file.designId,
      context,
      { allowCheckpointFailureSkip: true },
    );
    const checkpointField = checkpointSkippedResultField(checkpoint);

    if (identityOnly === true) {
      if (
        content === undefined ||
        !expectedVersionHash ||
        filename !== undefined ||
        fileType !== undefined ||
        syncCollab === false ||
        !operationSource ||
        !Number.isSafeInteger(operationRevision) ||
        (operationRevision ?? 0) <= 0
      ) {
        throw new Error(
          "Identity-only updates require a source version and operation lineage, and cannot change file metadata or disable collaboration sync.",
        );
      }
      const write = await writeInlineSourceFile({
        designId: file.designId,
        file,
        content,
        expectedVersionHash,
        identityOnly: true,
        operationSource,
        operationRevision,
      });
      return {
        id,
        updated: true,
        versionHash: write.versionHash,
        ...checkpointField,
      };
    }

    // Optimistic-concurrency guard (cross-pipeline write-race fix): a content
    // update here is a FULL-document write that, when syncCollab runs, is
    // char-diffed against the live collaboration text (applyText). If the
    // caller computed `content` from a since-stale read — e.g. a base Fill
    // style commit queued while a shader apply-source-edit landed for the
    // same file — that silent diff-merge is exactly how the shader/fill
    // interleave corrupted or lost screen content. When the caller supplies
    // the hash of the content it based this write on, verify the file still
    // matches before writing and fail loud otherwise, mirroring
    // writeInlineSourceFile's expectedVersionHash contract.
    //
    // TOCTOU fix: the hash check alone is NOT enough — two concurrent
    // update-file calls can each read the same live text, each pass the hash
    // check, and then both proceed to write, with the second one silently
    // winning over a base it never actually re-validated against. Route the
    // whole hash-check -> write -> collab-sync critical section through the
    // SAME per-file in-process lock writeInlineSourceFile uses
    // (withSourceFileWriteLock, server/source-workspace.ts), keyed by file
    // id, so a second guarded caller's hash check runs AFTER the first
    // caller's write has fully landed and observes the true current state
    // (and is rejected by the hash guard instead of interleaving). Callers
    // that don't pass a hash keep today's last-write-wins behavior for the
    // VALUE they write, but the write itself is still serialized under the
    // same lock so it can't interleave with a concurrent guarded writer's own
    // read-check-write.
    let skippedStaleMirror = false;
    let skippedStaleOperation = false;
    let exactOperationAlreadyPersisted = false;
    let persistedVersionHash: string | undefined;
    let persistedUpdatedAt: string | undefined;

    const runMutation = (lease?: PreparedYDocMutationLease) =>
      withDesignSourceMutationTransaction(file.designId, async (tx) => {
        await lockDesignFilesTable(tx);
        for (let attempt = 0; attempt < 4; attempt += 1) {
          skippedStaleMirror = false;
          skippedStaleOperation = false;
          exactOperationAlreadyPersisted = false;
          persistedUpdatedAt = undefined;
          const [persistedFile] = await tx
            .select({
              content: schema.designFiles.content,
              fileType: schema.designFiles.fileType,
              contentOperationSource: schema.designFiles.contentOperationSource,
              contentOperationRevision:
                schema.designFiles.contentOperationRevision,
              contentOperationResultHash:
                schema.designFiles.contentOperationResultHash,
            })
            .from(schema.designFiles)
            .where(eq(schema.designFiles.id, id))
            .limit(1);
          if (!persistedFile) {
            throw fileNotFound(id);
          }

          const persistedContentHash = sourceContentHash(persistedFile.content);
          persistedVersionHash = persistedContentHash;
          let collabExists = false;
          let needsCollabSeed = false;
          let liveContent: string;
          if (lease) {
            collabExists = await hasCollabState(id);
            needsCollabSeed = !collabExists || lease.baseVersion === null;
            if (needsCollabSeed) {
              applyTextToYDoc(
                lease.doc,
                "content",
                persistedFile.content,
                "agent",
              );
            }
            liveContent = readPreparedSourceText(lease);
          } else if (content !== undefined) {
            collabExists = await hasCollabState(id);
            liveContent = (
              await readLiveSourceFile({
                ...file,
                content: persistedFile.content,
                fileType: persistedFile.fileType ?? file.fileType ?? "html",
              })
            ).content;
          } else {
            liveContent = persistedFile.content;
          }
          if (content !== undefined) {
            assertDesignHtmlEditIntegrity({
              previousContent: liveContent,
              nextContent: content,
              fileType:
                fileType ?? persistedFile.fileType ?? file.fileType ?? "html",
            });
          }
          if (content !== undefined && context?.caller !== "frontend") {
            assertLockedLayersPreserved(liveContent, content);
          }
          const hasVersionedContentOperation =
            content !== undefined &&
            operationSource !== undefined &&
            operationRevision !== undefined;
          const requestedOperationRevision = operationRevision ?? null;
          const sameOperationSource =
            hasVersionedContentOperation &&
            persistedFile.contentOperationSource === operationSource &&
            typeof persistedFile.contentOperationRevision === "number";

          if (
            sameOperationSource &&
            requestedOperationRevision !== null &&
            requestedOperationRevision <=
              persistedFile.contentOperationRevision!
          ) {
            skippedStaleOperation = true;
            exactOperationAlreadyPersisted =
              requestedOperationRevision ===
                persistedFile.contentOperationRevision &&
              content !== undefined &&
              persistedContentHash === sourceContentHash(content) &&
              persistedFile.contentOperationResultHash === persistedContentHash;
          }

          // SQL-mirror-only skip path: when the caller explicitly opted OUT of
          // collab sync (syncCollab: false) and supplied an expectedVersionHash
          // that no longer matches the LIVE collab text, and a live collab doc
          // actually exists for this file, the caller's `content` was computed
          // from a base that a live editor has since moved past. Overwriting the
          // SQL mirror column with that stale content here would silently regress
          // it out from under the live document (which stays the source of
          // truth) the next time it's read back out of SQL. Skip the content
          // write instead of throwing: filename/fileType updates in the same call
          // still proceed, and the caller gets `skippedStaleMirror: true` back
          // instead of a thrown error, because they explicitly said they weren't
          // trying to sync into collab in the first place. Every other
          // expectedVersionHash combination (syncCollab true/default, or no live
          // collab state, or a matching hash, or no hash at all) is UNCHANGED.
          //
          // Own-edit false-positive fix: a single client's own edit reaches the
          // live collab doc via TWO independent, unordered paths — the Yjs
          // update (~80ms client debounce, applied to the server's in-memory doc
          // as soon as its POST lands) and this guarded update-file call (~400ms
          // client debounce). The Yjs path usually wins the race, so by the time
          // this call's hash check runs, `liveContent` often already equals the
          // very `content` this call is trying to write — that is NOT a
          // divergent concurrent edit, it's the same edit having arrived early
          // by a different transport. Comparing hashes first would reject that
          // as "stale" and permanently skip the SQL mirror write (there is no
          // background job that later reconciles design_files.content from the
          // live collab doc — see hasCollabState below), silently losing writes
          // on every edit after the first in a session. Check content equality
          // BEFORE the hash comparison so this exact-match case always proceeds
          // as a normal write instead of hitting either the skip or throw path.
          let skipContentWrite = skippedStaleOperation;
          if (
            !skippedStaleOperation &&
            expectedVersionHash !== undefined &&
            content !== undefined
          ) {
            if (
              liveContent !== content &&
              sourceContentHash(liveContent) !== expectedVersionHash
            ) {
              if (syncCollab === false && collabExists) {
                if (persistedContentHash !== expectedVersionHash) {
                  skipContentWrite = true;
                  skippedStaleMirror = true;
                }
              } else {
                logSaveConflictDebug("content-conflict", {
                  id,
                  caller: context?.caller,
                  syncCollab,
                  operationRevision: operationRevision ?? null,
                  expectedVersionHash,
                  sentContentHash: sourceContentHash(content),
                  liveContentHash: sourceContentHash(liveContent),
                  persistedMirrorHash: persistedContentHash,
                });
                const conflict = new Error(
                  "File changed since it was read. Re-read the file and retry.",
                ) as Error & { statusCode?: number };
                conflict.statusCode = 409;
                throw conflict;
              }
            }
          }

          const updates: Record<string, unknown> = { updatedAt: now };
          if (content !== undefined && !skipContentWrite) {
            updates.content = content;
            persistedVersionHash = sourceContentHash(content);
            if (
              operationSource !== undefined &&
              operationRevision !== undefined
            ) {
              updates.contentOperationSource = operationSource;
              updates.contentOperationRevision = operationRevision;
              updates.contentOperationResultHash = persistedVersionHash;
            } else {
              updates.contentOperationSource = null;
              updates.contentOperationRevision = null;
              updates.contentOperationResultHash = null;
            }
          }
          if (filename !== undefined) updates.filename = filename;
          if (fileType !== undefined) updates.fileType = fileType;

          const requiresContentCas =
            hasVersionedContentOperation && !skipContentWrite;
          const contentCasWhere = requiresContentCas
            ? and(
                eq(schema.designFiles.content, persistedFile.content),
                persistedFile.contentOperationSource == null
                  ? isNull(schema.designFiles.contentOperationSource)
                  : eq(
                      schema.designFiles.contentOperationSource,
                      persistedFile.contentOperationSource,
                    ),
                persistedFile.contentOperationRevision == null
                  ? isNull(schema.designFiles.contentOperationRevision)
                  : eq(
                      schema.designFiles.contentOperationRevision,
                      persistedFile.contentOperationRevision,
                    ),
                persistedFile.contentOperationResultHash == null
                  ? isNull(schema.designFiles.contentOperationResultHash)
                  : eq(
                      schema.designFiles.contentOperationResultHash,
                      persistedFile.contentOperationResultHash,
                    ),
              )
            : undefined;

          if (
            content !== undefined &&
            !syncCollab &&
            lease !== undefined &&
            lease.baseVersion !== null
          ) {
            if (!lease) {
              throw new Error(
                "Mirror-only content writes require a prepared source document.",
              );
            }
            try {
              await lease.persist(
                getDesignSourceMutationExec(tx),
                readPreparedSourceText(lease),
              );
            } catch (error) {
              if (error instanceof CollabBaseVersionConflictError) {
                throw new SourceWorkspaceEditConflictError(
                  "File changed while its live collaboration document was being saved. Re-read the file and retry.",
                );
              }
              throw error;
            }
          }

          let updateResult: unknown;

          if (filename !== undefined) {
            const [collision] = await tx
              .select({ id: schema.designFiles.id })
              .from(schema.designFiles)
              .where(
                and(
                  eq(schema.designFiles.designId, file.designId),
                  eq(schema.designFiles.filename, filename),
                ),
              )
              .limit(1);
            if (collision && collision.id !== id) {
              throw new Error(
                `File "${filename}" already exists in design ${file.designId}`,
              );
            }
            updateResult = await tx
              .update(schema.designFiles)
              .set(updates)
              .where(and(eq(schema.designFiles.id, id), contentCasWhere));
          } else {
            updateResult = await tx
              .update(schema.designFiles)
              .set(updates)
              .where(and(eq(schema.designFiles.id, id), contentCasWhere));
          }

          if (requiresContentCas && affectedRowCount(updateResult) === 0) {
            throw new SourceWorkspaceEditConflictError(
              "File changed while it was being saved. Re-read the file and retry.",
            );
          }

          if (
            requiresContentCas &&
            affectedRowCount(updateResult) === undefined
          ) {
            const [confirmed] = await tx
              .select({
                content: schema.designFiles.content,
                contentOperationSource:
                  schema.designFiles.contentOperationSource,
                contentOperationRevision:
                  schema.designFiles.contentOperationRevision,
                contentOperationResultHash:
                  schema.designFiles.contentOperationResultHash,
              })
              .from(schema.designFiles)
              .where(eq(schema.designFiles.id, id))
              .limit(1);
            if (!confirmed) throw fileNotFound(id);
            const confirmedHash = sourceContentHash(confirmed.content);
            const exactOperationPersisted =
              confirmed.contentOperationSource === operationSource &&
              confirmed.contentOperationRevision === operationRevision &&
              confirmed.contentOperationResultHash === persistedVersionHash &&
              confirmedHash === persistedVersionHash;
            if (!exactOperationPersisted) {
              if (
                confirmed.contentOperationSource === operationSource &&
                typeof confirmed.contentOperationRevision === "number" &&
                operationRevision !== undefined &&
                confirmed.contentOperationRevision >= operationRevision
              ) {
                skippedStaleOperation = true;
                persistedVersionHash = confirmedHash;
                await tx
                  .update(schema.designs)
                  .set({ updatedAt: now })
                  .where(eq(schema.designs.id, file.designId));
                return;
              }
              throw new SourceWorkspaceEditConflictError(
                "File changed while it was being saved. Re-read the file and retry.",
              );
            }
          }

          const shouldConvergePersistedRetry =
            exactOperationAlreadyPersisted && syncCollab;
          if (
            content !== undefined &&
            (!skipContentWrite || shouldConvergePersistedRetry) &&
            syncCollab
          ) {
            if (!lease) {
              throw new Error(
                "Collaboration writes require a prepared source document.",
              );
            }
            applyTextToYDoc(lease.doc, "content", content, "agent");
            await lease.persist(getDesignSourceMutationExec(tx), content);
          }
          await tx
            .update(schema.designs)
            .set({ updatedAt: now })
            .where(eq(schema.designs.id, file.designId));
          persistedUpdatedAt = now;
          return;
        }
        logSaveConflictDebug("retry-exhausted", {
          id,
          caller: context?.caller,
          operationSource: operationSource ?? null,
          operationRevision: operationRevision ?? null,
          expectedVersionHash,
        });
        const exhausted = new Error(
          "File changed repeatedly while it was being saved. Re-read the file and retry.",
        ) as Error & { statusCode?: number };
        exhausted.statusCode = 409;
        throw exhausted;
      });

    try {
      await (content !== undefined
        ? withPreparedSourceFileMutation(
            id,
            syncCollab ? "agent" : undefined,
            runMutation,
          )
        : withSourceFileWriteLock(id, runMutation));
    } catch (error) {
      if (error instanceof CollabBaseVersionConflictError) {
        throw new SourceWorkspaceEditConflictError(
          "File changed while its live collaboration document was being saved. Re-read the file and retry.",
        );
      }
      throw error;
    }

    if (skippedStaleMirror) {
      return {
        id,
        updated: true,
        skippedStaleMirror: true,
        ...checkpointField,
      };
    }
    if (operationSource !== undefined && operationRevision !== undefined) {
      return {
        id,
        updated: true,
        ...(skippedStaleOperation ? { skippedStaleOperation: true } : {}),
        versionHash: persistedVersionHash,
        ...(persistedUpdatedAt ? { updatedAt: persistedUpdatedAt } : {}),
        ...checkpointField,
      };
    }
    return { id, updated: true, ...checkpointField };
  },
});
