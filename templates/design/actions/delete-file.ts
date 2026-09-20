import { defineAction } from "@agent-native/core/action";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  snapshotDesignBeforeAgentEditInVersionLock,
  withDesignVersionLock,
} from "../server/lib/design-versions.js";
import {
  affectedRowCount,
  designSourceMutationLockKey,
  lockDesignFilesTable,
} from "../server/source-workspace.js";
import { isOverviewScreenFile } from "../shared/design-files.js";
import { countLockedLayers } from "../shared/locked-layers.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function pruneKeyedRecord(
  value: unknown,
  fileId: string,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const next = { ...value };
  delete next[fileId];
  return next;
}

function variantScreenMatchesFile(screen: unknown, fileId: string): boolean {
  if (typeof screen === "string") return screen === fileId;
  return isRecord(screen) && screen.id === fileId;
}

function pruneDesignVariantSets(
  value: unknown,
  fileId: string,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const next: Record<string, unknown> = {};
  for (const [key, rawSet] of Object.entries(value)) {
    if (!isRecord(rawSet) || !Array.isArray(rawSet.screens)) {
      next[key] = rawSet;
      continue;
    }
    const screens = rawSet.screens.filter(
      (screen) => !variantScreenMatchesFile(screen, fileId),
    );
    if (screens.length <= 1) continue;
    next[key] = { ...rawSet, screens };
  }
  return next;
}

function pruneDeletedFileMetadata(
  data: Record<string, unknown>,
  fileId: string,
): Record<string, unknown> {
  return {
    ...data,
    canvasFrames: pruneKeyedRecord(data.canvasFrames, fileId) ?? {},
    screenMetadata: pruneKeyedRecord(data.screenMetadata, fileId) ?? {},
    localhostScreens: pruneKeyedRecord(data.localhostScreens, fileId) ?? {},
    designVariantSets:
      pruneDesignVariantSets(data.designVariantSets, fileId) ?? {},
  };
}

function nextUpdatedAt(current: string | null, now: Date): string {
  const currentMs = current ? Date.parse(current) : Number.NaN;
  return new Date(
    Math.max(now.getTime(), Number.isFinite(currentMs) ? currentMs + 1 : 0),
  ).toISOString();
}

function parseDesignData(
  designId: string,
  serialized: string | null,
): Record<string, unknown> {
  if (serialized === null) return {};
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (isRecord(parsed)) return parsed;
  } catch {
    throw new Error(`Design "${designId}" has invalid data JSON.`);
  }
  throw new Error(`Design "${designId}" has invalid data JSON.`);
}

export default defineAction({
  description:
    "Delete a file from a design project. Idempotent: if the file is already gone, returns deleted=false so cleanup retries can continue. Validates ownership via the parent design's access when the file exists.",
  schema: z.object({
    id: z.string().describe("File ID to delete"),
    allowLockedLayers: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Delete the screen even though it holds locked layers. Only set this when the user explicitly asked for that screen to go.",
      ),
    historyCheckpointId: z
      .string()
      .optional()
      .describe(
        "Existing frontend editor checkpoint to reuse for one grouped screen deletion.",
      ),
  }),
  run: async ({ id, allowLockedLayers, historyCheckpointId }, context) => {
    const db = getDb();

    // Look up the file to get its designId for access check
    const [file] = await db
      .select({
        id: schema.designFiles.id,
        designId: schema.designFiles.designId,
        filename: schema.designFiles.filename,
        fileType: schema.designFiles.fileType,
        content: schema.designFiles.content,
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

    if (!file) return { id, deleted: false, alreadyMissing: true };

    await assertAccess("design", file.designId, "editor");
    // Locks exist to stop an agent destroying template branding in passing.
    // A person deleting their own screen has already decided, and every
    // template-backed screen carries locked layers — without this opt-in they
    // could not be removed at all.
    if (!allowLockedLayers && countLockedLayers(file.content) > 0) {
      throw new Error(
        "This screen contains locked layers. Unlock them before deleting the screen, or pass allowLockedLayers when the user asked for the whole screen to go.",
      );
    }

    if (historyCheckpointId !== undefined) {
      if (context?.caller !== "frontend") {
        throw new Error(
          "A reusable editor history checkpoint is only valid for frontend deletes.",
        );
      }
      const [checkpoint] = await db
        .select({
          id: schema.designVersions.id,
          designId: schema.designVersions.designId,
        })
        .from(schema.designVersions)
        .where(
          and(
            eq(schema.designVersions.id, historyCheckpointId),
            eq(schema.designVersions.designId, file.designId),
          ),
        )
        .limit(1);
      if (!checkpoint) {
        throw new Error(
          "The editor history checkpoint is no longer available.",
        );
      }
    }

    // Restore locks the same design and updates file rows before designs.data.
    // Keep the checkpoint and mutation under the same table/version boundary so
    // history cannot capture a state that interleaves with the delete.
    const deleted = await withDesignVersionLock(file.designId, async () => {
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${designSourceMutationLockKey(file.designId)}, 0::bigint))`,
        );
        await lockDesignFilesTable(tx);
        const currentFiles = await tx
          .select({
            id: schema.designFiles.id,
            filename: schema.designFiles.filename,
            fileType: schema.designFiles.fileType,
          })
          .from(schema.designFiles)
          .where(eq(schema.designFiles.designId, file.designId))
          .for("update");
        const currentFile = currentFiles.find(
          (candidate) => candidate.id === id,
        );
        if (!currentFile) return false;
        if (
          isOverviewScreenFile(currentFile) &&
          currentFiles.filter(isOverviewScreenFile).length <= 1
        ) {
          throw new Error(
            "A design must keep at least one user screen. Delete another screen first.",
          );
        }
        if (historyCheckpointId === undefined) {
          await snapshotDesignBeforeAgentEditInVersionLock(
            file.designId,
            context,
            tx,
          );
        }

        const deleteResult = await tx
          .delete(schema.designFiles)
          .where(
            and(
              eq(schema.designFiles.id, id),
              eq(schema.designFiles.designId, file.designId),
            ),
          );
        const affected = affectedRowCount(deleteResult);
        if (affected === 0) return false;
        if (affected === undefined)
          throw new Error("Could not verify that the design file was deleted.");
        if (affected !== 1)
          throw new Error("Unexpected design file delete result.");

        const [design] = await tx
          .select({
            data: schema.designs.data,
            updatedAt: schema.designs.updatedAt,
          })
          .from(schema.designs)
          .where(eq(schema.designs.id, file.designId))
          .for("update");
        if (!design) throw new Error(`Design "${file.designId}" not found.`);

        const updatedAt = nextUpdatedAt(design.updatedAt, new Date());
        const data = pruneDeletedFileMetadata(
          parseDesignData(file.designId, design.data),
          id,
        );
        data.updatedAt = updatedAt;
        const designUpdateResult = await tx
          .update(schema.designs)
          .set({ data: JSON.stringify(data), updatedAt })
          .where(eq(schema.designs.id, file.designId));
        const designAffected = affectedRowCount(designUpdateResult);
        if (designAffected === undefined) {
          throw new Error(
            "Could not verify that the design metadata was updated.",
          );
        }
        if (designAffected !== 1) {
          throw new Error("Unexpected design metadata update result.");
        }
        return true;
      });
    });

    return deleted
      ? { id, deleted: true }
      : { id, deleted: false, alreadyMissing: true };
  },
});
