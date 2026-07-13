import { defineAction } from "@agent-native/core";
import {
  hasCollabState,
  getText,
  applyText,
  seedFromText,
} from "@agent-native/core/collab";
import { isPostgres } from "@agent-native/core/db";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { withSourceFileWriteLock } from "../server/source-workspace.js";
import { assertDesignHtmlEditIntegrity } from "../shared/html-integrity.js";
import { assertLockedLayersPreserved } from "../shared/locked-layers.js";
import { sourceContentHash } from "../shared/source-workspace.js";

function rowsAffected(result: unknown): number | undefined {
  const candidate = result as {
    rowsAffected?: unknown;
    rowCount?: unknown;
    changes?: unknown;
  } | null;
  const value =
    candidate?.rowsAffected ?? candidate?.rowCount ?? candidate?.changes;
  return typeof value === "number" ? value : undefined;
}

/**
 * Returns `{ id, updated: true }` on success, matching the pre-existing
 * contract — callers that only check `result.updated === true` see no
 * behavior change.
 *
 * `skippedStaleMirror?: true` is added to the result ONLY in the narrow
 * SQL-mirror-only staleness case: `content` was provided, `syncCollab` was
 * explicitly `false`, a live collaboration document exists for this file,
 * and the caller's `expectedVersionHash` matches NEITHER the live collab
 * text, NOR the `content` being written (an own edit that raced ahead via
 * Yjs), NOR the current SQL mirror content. A caller whose hash matches the
 * current mirror is the mirror column's own lineage (mirror-lineage rescue):
 * it proceeds instead of skipping, advancing the mirror AND diff-merging its
 * content into the live doc.
 * In the genuinely-stale case the content column is intentionally left
 * untouched (the live
 * collab document remains the source of truth) while any `filename`/
 * `fileType` updates in the same call still apply, and the action returns
 * success instead of throwing. The field is omitted (not `false`) in every
 * other case, so existing callers that don't check for it observe no
 * difference. When `expectedVersionHash` is omitted entirely, or the hash
 * matches, or `syncCollab` is left at its default `true`, or no collab state
 * exists yet for the file, this skip path never triggers.
 *
 * Versioned browser saves additionally return `versionHash` for the content
 * that remains persisted. `skippedStaleOperation?: true` means an equal or
 * newer revision from that same browser tab was already accepted, so this
 * late request was treated as an idempotent content no-op.
 */
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
    }),
  run: async (
    {
      id,
      content,
      filename,
      fileType,
      syncCollab,
      expectedVersionHash,
      operationSource,
      operationRevision,
    },
    context,
  ) => {
    // Path traversal guard on filename
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

    // Look up the file to get its designId for access check
    const [file] = await db
      .select({
        id: schema.designFiles.id,
        designId: schema.designFiles.designId,
        fileType: schema.designFiles.fileType,
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
      throw new Error(`File not found: ${id}`);
    }

    await assertAccess("design", file.designId, "editor");

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

    await withSourceFileWriteLock(id, async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        skippedStaleMirror = false;
        skippedStaleOperation = false;
        exactOperationAlreadyPersisted = false;
        const [persistedFile] = await db
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
          throw new Error(`File not found: ${id}`);
        }

        const persistedContentHash = sourceContentHash(persistedFile.content);
        persistedVersionHash = persistedContentHash;
        const collabExists =
          content !== undefined ? await hasCollabState(id) : false;
        const liveContent =
          content !== undefined && collabExists
            ? await getText(id, "content")
            : persistedFile.content;
        if (content !== undefined) {
          assertDesignHtmlEditIntegrity({
            previousContent: liveContent,
            nextContent: content,
            fileType:
              fileType ?? persistedFile.fileType ?? file.fileType ?? "html",
          });
        }
        if (
          content !== undefined &&
          context?.caller !== "frontend" &&
          (fileType === "html" ||
            liveContent.includes("data-agent-native-locked"))
        ) {
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

        // A pagehide keepalive can overtake the older normal fetch for this
        // same tab. Once the newer revision has committed, the late request is
        // an idempotent no-op regardless of its stale expectedVersionHash. Do
        // this before the content hash guard so request arrival order cannot
        // turn a correct latest save into a conflict or overwrite.
        if (
          sameOperationSource &&
          requestedOperationRevision !== null &&
          requestedOperationRevision <= persistedFile.contentOperationRevision!
        ) {
          skippedStaleOperation = true;
          // The SQL CAS may have committed before the separate collab apply
          // failed. A retry of that exact operation must be allowed to finish
          // convergence; an older revision must remain a strict no-op. Require
          // both persisted hashes to prove the requested content is exactly
          // what this operation committed before re-running any side effect.
          exactOperationAlreadyPersisted =
            requestedOperationRevision ===
              persistedFile.contentOperationRevision &&
            content !== undefined &&
            persistedContentHash === sourceContentHash(content) &&
            persistedFile.contentOperationResultHash === persistedContentHash;
        }

        // Several rapid saves may all have been queued from the same acked
        // base. A successor from the SAME tab may advance from the previous
        // accepted result even when its queue-time expected hash predates that
        // result. Only trust this lineage if the current SQL mirror still
        // equals the result hash recorded with the prior operation; an
        // intervening writer breaks the chain and keeps the ordinary hash
        // conflict guard fully active.
        const sameSourceSuccessorHash =
          sameOperationSource &&
          !skippedStaleOperation &&
          requestedOperationRevision !== null &&
          requestedOperationRevision >
            persistedFile.contentOperationRevision! &&
          persistedFile.contentOperationResultHash === persistedContentHash
            ? persistedContentHash
            : undefined;

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
        let mirrorLineageCollabSync = false;
        if (
          !skippedStaleOperation &&
          expectedVersionHash !== undefined &&
          content !== undefined
        ) {
          const acceptedBaseHashes = new Set([
            expectedVersionHash,
            ...(sameSourceSuccessorHash ? [sameSourceSuccessorHash] : []),
          ]);
          if (
            liveContent !== content &&
            !acceptedBaseHashes.has(sourceContentHash(liveContent))
          ) {
            if (syncCollab === false && collabExists) {
              // Mirror-lineage rescue (sequential-edit data-loss fix, verified
              // live): the client's Yjs transact and its guarded update-file
              // call ride two independent transports, and the Yjs pipe can lag
              // or silently die — reproduced with a live collab doc that never
              // received EITHER of two sequential scrub edits while the HTTP
              // saves advanced the SQL mirror normally. Comparing the caller
              // only against that stale live text mis-classified the SECOND
              // save as a divergent writer and silently dropped it. When the
              // caller's expectedVersionHash matches the CURRENT SQL mirror,
              // the caller is the mirror's own uninterrupted lineage (a plain
              // CAS success against the column this write updates) while the
              // live doc is the diverging party — a dead/lagging client Yjs
              // pipe or a concurrent live-only editor. Do NOT skip, and do NOT
              // silently drop either side: proceed with the mirror write AND
              // push `content` through the collab layer exactly like
              // syncCollab:true does (mirrorLineageCollabSync below). The
              // applyText char-diff merge folds the caller's change into the
              // live doc as a CRDT diff, so no one's edits are dropped: the
              // mirror advances with the caller, and the live doc receives the
              // caller's change as a diff-merge that preserves any other
              // editor's live edits. Only callers matching NEITHER the live
              // text NOR the mirror are genuinely stale and still hit the skip
              // below.
              if (acceptedBaseHashes.has(persistedContentHash)) {
                // Caller is exactly at the persisted mirror's tip — the live
                // collab doc is the lagging party, not the caller. Write the
                // mirror normally and also sync the caller's content into the
                // live doc via the collab diff-merge below.
                mirrorLineageCollabSync = true;
              } else {
                skipContentWrite = true;
                skippedStaleMirror = true;
              }
            } else {
              throw new Error(
                "File changed since it was read. Re-read the file and retry.",
              );
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
            // An unversioned writer starts a different lineage. Clearing the
            // browser operation marker prevents a later request from treating
            // stale transport metadata as proof that no writer intervened.
            updates.contentOperationSource = null;
            updates.contentOperationRevision = null;
            updates.contentOperationResultHash = null;
          }
        }
        if (filename !== undefined) updates.filename = filename;
        if (fileType !== undefined) updates.fileType = fileType;

        // The JS lock above is intentionally fast but process-local. Versioned
        // browser writes also need a database CAS so two serverless instances
        // cannot both validate the same snapshot and let the later SQL update
        // clobber the winner. If another instance moves any part of the content
        // lineage first, rowsAffected is zero and this loop re-reads the row;
        // the next pass then classifies the request as a stale no-op, a valid
        // same-source successor, or a real cross-writer hash conflict.
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

        let updateResult: unknown;

        if (filename !== undefined && isPostgres()) {
          updateResult = await db.transaction(async (tx) => {
            // Postgres evaluates concurrent NOT EXISTS updates under MVCC, so a
            // guarded UPDATE alone can still race. Serialize design-file renames in
            // this rare path without using SQLite's fragile async savepoint wrapper.
            await (
              tx as unknown as { execute: (query: unknown) => Promise<unknown> }
            ).execute(sql`LOCK TABLE design_files IN SHARE ROW EXCLUSIVE MODE`);
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
            return tx
              .update(schema.designFiles)
              .set(updates)
              .where(and(eq(schema.designFiles.id, id), contentCasWhere));
          });
        } else {
          // Reject colliding SQLite renames as part of the write. SQLite's local
          // async transaction wrapper can fail under concurrent editor/collab writes,
          // so keep this to one guarded UPDATE instead of a SELECT-then-UPDATE window.
          const renameWhere =
            filename === undefined
              ? undefined
              : and(
                  sql`NOT EXISTS (
                SELECT 1 FROM design_files AS sibling
                WHERE sibling.design_id = ${file.designId}
                  AND sibling.filename = ${filename}
                  AND sibling.id <> ${id}
              )`,
                );
          const updateWhere = and(
            eq(schema.designFiles.id, id),
            renameWhere,
            contentCasWhere,
          );

          updateResult = await db
            .update(schema.designFiles)
            .set(updates)
            .where(updateWhere);

          if (filename !== undefined && rowsAffected(updateResult) === 0) {
            const [collision] = await db
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
          }
        }

        if (requiresContentCas && rowsAffected(updateResult) === 0) {
          continue;
        }

        if (requiresContentCas && rowsAffected(updateResult) === undefined) {
          const [confirmed] = await db
            .select({
              content: schema.designFiles.content,
              contentOperationSource: schema.designFiles.contentOperationSource,
              contentOperationRevision:
                schema.designFiles.contentOperationRevision,
              contentOperationResultHash:
                schema.designFiles.contentOperationResultHash,
            })
            .from(schema.designFiles)
            .where(eq(schema.designFiles.id, id))
            .limit(1);
          if (!confirmed) throw new Error(`File not found: ${id}`);
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
              return;
            }
            continue;
          }
        }

        // Push content through the collab layer so live editors see the change.
        // mirrorLineageCollabSync: a syncCollab:false caller whose hash matched
        // the current SQL mirror (mirror-lineage rescue) also syncs here, so a
        // dead/lagging live doc receives the caller's change as a CRDT
        // diff-merge instead of silently diverging from the mirror.
        const shouldConvergePersistedRetry =
          exactOperationAlreadyPersisted && syncCollab;
        if (
          content !== undefined &&
          (!skipContentWrite || shouldConvergePersistedRetry) &&
          (syncCollab || mirrorLineageCollabSync)
        ) {
          const collabExists = await hasCollabState(id);
          if (collabExists) {
            await applyText(id, content, "content", "agent");
          } else {
            await seedFromText(id, content);
          }

          // SQL CAS is cross-instance, while the collab document uses a
          // separate transport. If another instance committed a newer SQL
          // revision while this request was applying its text diff, converge
          // the live document back to the current SQL winner before returning.
          // Whichever writer finishes last performs this same check, so a late
          // older collab apply cannot leave Yjs behind the monotonic mirror.
          const [latestPersisted] = await db
            .select({
              content: schema.designFiles.content,
              contentOperationSource: schema.designFiles.contentOperationSource,
              contentOperationRevision:
                schema.designFiles.contentOperationRevision,
            })
            .from(schema.designFiles)
            .where(eq(schema.designFiles.id, id))
            .limit(1);
          if (latestPersisted && latestPersisted.content !== content) {
            const collabStillExists = await hasCollabState(id);
            if (collabStillExists) {
              await applyText(id, latestPersisted.content, "content", "agent");
            } else {
              await seedFromText(id, latestPersisted.content);
            }
            persistedVersionHash = sourceContentHash(latestPersisted.content);
            if (
              latestPersisted.contentOperationSource === operationSource &&
              typeof latestPersisted.contentOperationRevision === "number" &&
              operationRevision !== undefined &&
              latestPersisted.contentOperationRevision >= operationRevision
            ) {
              skippedStaleOperation = true;
            }
          }
        }
        return;
      }
      throw new Error(
        "File changed repeatedly while it was being saved. Re-read the file and retry.",
      );
    });

    // Update the parent design's updatedAt timestamp. This still runs even
    // when the content write was skipped (skippedStaleMirror): filename/
    // fileType may have changed in the same call, and even a content-only
    // call that hit the skip path still represents a real request the design
    // was touched by, matching this action's existing unconditional-bump
    // contract for every other call shape.
    await db
      .update(schema.designs)
      .set({ updatedAt: now })
      .where(eq(schema.designs.id, file.designId));

    if (skippedStaleMirror) {
      return { id, updated: true, skippedStaleMirror: true };
    }
    if (operationSource !== undefined && operationRevision !== undefined) {
      return {
        id,
        updated: true,
        ...(skippedStaleOperation ? { skippedStaleOperation: true } : {}),
        versionHash: persistedVersionHash,
      };
    }
    return { id, updated: true };
  },
});
