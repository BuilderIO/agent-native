import { defineAction } from "@agent-native/core";
import {
  hasCollabState,
  getText,
  applyText,
  seedFromText,
} from "@agent-native/core/collab";
import { isPostgres } from "@agent-native/core/db";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { withSourceFileWriteLock } from "../server/source-workspace.js";
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
 */
export default defineAction({
  description:
    "Update an existing file in a design project. " +
    "Only provided fields are updated; omitted fields are left unchanged. " +
    "Also updates the parent design's updatedAt timestamp.",
  schema: z.object({
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
  }),
  run: async ({
    id,
    content,
    filename,
    fileType,
    syncCollab,
    expectedVersionHash,
  }) => {
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

    await withSourceFileWriteLock(id, async () => {
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
      let skipContentWrite = false;
      let mirrorLineageCollabSync = false;
      if (expectedVersionHash !== undefined && content !== undefined) {
        const collabExists = await hasCollabState(id);
        let liveContent: string;
        if (collabExists) {
          liveContent = await getText(id, "content");
        } else {
          const [current] = await db
            .select({ content: schema.designFiles.content })
            .from(schema.designFiles)
            .where(eq(schema.designFiles.id, id))
            .limit(1);
          liveContent = current?.content ?? "";
        }
        if (
          liveContent !== content &&
          sourceContentHash(liveContent) !== expectedVersionHash
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
            const [mirrorRow] = await db
              .select({ content: schema.designFiles.content })
              .from(schema.designFiles)
              .where(eq(schema.designFiles.id, id))
              .limit(1);
            if (
              sourceContentHash(mirrorRow?.content ?? "") ===
              expectedVersionHash
            ) {
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
      if (content !== undefined && !skipContentWrite) updates.content = content;
      if (filename !== undefined) updates.filename = filename;
      if (fileType !== undefined) updates.fileType = fileType;

      if (filename !== undefined && isPostgres()) {
        await db.transaction(async (tx) => {
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
          await tx
            .update(schema.designFiles)
            .set(updates)
            .where(eq(schema.designFiles.id, id));
        });
      } else {
        // Reject colliding SQLite renames as part of the write. SQLite's local
        // async transaction wrapper can fail under concurrent editor/collab writes,
        // so keep this to one guarded UPDATE instead of a SELECT-then-UPDATE window.
        const updateWhere =
          filename === undefined
            ? eq(schema.designFiles.id, id)
            : and(
                eq(schema.designFiles.id, id),
                sql`NOT EXISTS (
                SELECT 1 FROM design_files AS sibling
                WHERE sibling.design_id = ${file.designId}
                  AND sibling.filename = ${filename}
                  AND sibling.id <> ${id}
              )`,
              );

        const updateResult = await db
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

      // Push content through the collab layer so live editors see the change.
      // mirrorLineageCollabSync: a syncCollab:false caller whose hash matched
      // the current SQL mirror (mirror-lineage rescue) also syncs here, so a
      // dead/lagging live doc receives the caller's change as a CRDT
      // diff-merge instead of silently diverging from the mirror.
      if (content !== undefined && (syncCollab || mirrorLineageCollabSync)) {
        const collabExists = await hasCollabState(id);
        if (collabExists) {
          await applyText(id, content, "content", "agent");
        } else {
          await seedFromText(id, content);
        }
      }
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

    return skippedStaleMirror
      ? { id, updated: true, skippedStaleMirror: true }
      : { id, updated: true };
  },
});
