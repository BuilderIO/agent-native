/**
 * restore-design-version — Task 5b.
 *
 * Restores a design to a previously captured checkpoint (design_versions
 * snapshot). Restore is itself undoable: it first writes a fresh `pre-restore`
 * checkpoint of the current state, then writes each snapshot file's content
 * back — updating existing files and recreating any that were since deleted —
 * and re-seeds the live collaboration document so open editors converge on the
 * restored content. Destructive by intent; the UI gates it behind a confirm.
 *
 * Additive to schema: only writes/updates file rows and versions rows; never
 * alters or drops columns.
 */

import { defineAction } from "@agent-native/core";
import { hasCollabState, seedFromText } from "@agent-native/core/collab";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  parseCheckpointSnapshotFiles,
  writeDesignCheckpoint,
} from "../server/lib/design-checkpoint.js";

export default defineAction({
  description:
    "Restore a design to a previously captured checkpoint (design_versions " +
    "snapshot id). First writes a fresh 'pre-restore' checkpoint of the current " +
    "state so the restore can itself be rolled back, then writes each snapshot " +
    "file's content back (updating existing files, recreating any deleted ones) " +
    "and re-seeds the live collaboration doc. Destructive by intent — confirm " +
    "with the user before calling.",
  schema: z.object({
    designId: z.string().describe("Design project ID to restore"),
    versionId: z
      .string()
      .describe("design_versions.id of the checkpoint to restore"),
  }),
  run: async ({ designId, versionId }) => {
    const db = getDb();
    await assertAccess("design", designId, "editor");

    const [version] = await db
      .select({
        id: schema.designVersions.id,
        snapshot: schema.designVersions.snapshot,
      })
      .from(schema.designVersions)
      .where(
        and(
          eq(schema.designVersions.id, versionId),
          eq(schema.designVersions.designId, designId),
        ),
      )
      .limit(1);
    if (!version) throw new Error(`Version not found: ${versionId}`);

    const snapshotFiles = parseCheckpointSnapshotFiles(version.snapshot);
    if (snapshotFiles.length === 0) {
      throw new Error("Checkpoint snapshot contains no restorable files");
    }

    // Checkpoint the pre-restore state first so this restore is undoable.
    const createdBy = getRequestUserEmail() ?? "agent";
    const preRestore = await writeDesignCheckpoint({
      designId,
      kind: "pre-restore",
      createdBy,
      trigger: `restore:${versionId}`,
      prune: true,
    });

    const now = new Date().toISOString();
    let filesRestored = 0;
    let filesRecreated = 0;
    for (const file of snapshotFiles) {
      const [existing] = await db
        .select({ id: schema.designFiles.id })
        .from(schema.designFiles)
        .where(
          and(
            eq(schema.designFiles.id, file.id),
            eq(schema.designFiles.designId, designId),
          ),
        )
        .limit(1);
      if (existing) {
        await db
          .update(schema.designFiles)
          .set({ content: file.content, updatedAt: now })
          .where(eq(schema.designFiles.id, file.id));
        filesRestored += 1;
      } else {
        await db.insert(schema.designFiles).values({
          id: file.id,
          designId,
          filename: file.filename,
          content: file.content,
          fileType: file.fileType ?? "html",
          createdAt: now,
          updatedAt: now,
        });
        filesRecreated += 1;
      }
      // Re-seed the live collab document so open editors converge on the
      // restored content (mirrors update-file's seed path).
      if (await hasCollabState(file.id)) {
        await seedFromText(file.id, file.content ?? "", "content");
      }
    }

    return {
      restored: true,
      versionId,
      preRestoreVersionId: preRestore.versionId,
      filesRestored,
      filesRecreated,
    };
  },
});
