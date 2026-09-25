import { defineAction } from "@agent-native/core/action";
import type { DbExecStatement } from "@agent-native/core/db";
import {
  isMissingOrganizationTableError,
  orgMembers,
} from "@agent-native/core/org";
import {
  accessFilter,
  assertAccess,
  currentAccess,
} from "@agent-native/core/sharing";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  snapshotDesignBeforeAgentEditInVersionLock,
  withDesignVersionLock,
} from "../server/lib/design-versions.js";
import {
  deleteVisualEditSnapshotBlobs,
  queueVisualEditSnapshotBlobCleanupInTransaction,
} from "../server/lib/visual-edit-snapshot-blobs.js";
import {
  affectedRowCount,
  designSourceMutationLockKey,
  lockDesignFilesTable,
} from "../server/source-workspace.js";
import { isOverviewScreenFile } from "../shared/design-files.js";
import { countLockedLayers } from "../shared/locked-layers.js";

function drizzleSqlForAccess(statement: DbExecStatement) {
  if (typeof statement === "string") return sql.raw(statement);
  const chunks: string[] = [];
  const params: unknown[] = [];
  const usesQuestionPlaceholders = statement.sql.includes("?");
  const placeholder = usesQuestionPlaceholders ? /\?/g : /\$(\d+)/g;
  let offset = 0;
  for (const match of statement.sql.matchAll(placeholder)) {
    const index = match.index ?? 0;
    chunks.push(statement.sql.slice(offset, index));
    const argumentIndex = usesQuestionPlaceholders
      ? params.length
      : Number(match[1]) - 1;
    if (argumentIndex < 0 || argumentIndex >= (statement.args?.length ?? 0)) {
      throw new Error("Transactional access query has mismatched parameters.");
    }
    params.push(statement.args?.[argumentIndex]);
    offset = index + match[0].length;
  }
  chunks.push(statement.sql.slice(offset));
  return sql(chunks as unknown as TemplateStringsArray, ...params);
}

function normalizeDrizzleExecResult(result: unknown): {
  rows: any[];
  rowsAffected: number;
} {
  const resultObject =
    result && typeof result === "object"
      ? (result as Record<string, unknown>)
      : undefined;
  const rows = Array.isArray(result)
    ? result
    : Array.isArray(resultObject?.rows)
      ? resultObject.rows
      : [];
  const rowsAffected = [
    resultObject?.rowCount,
    resultObject?.rowsAffected,
    resultObject?.affectedRows,
    resultObject?.count,
  ].find((value): value is number => typeof value === "number");
  return { rows, rowsAffected: rowsAffected ?? rows.length };
}

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

export function pruneDeletedFileMetadata(
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

interface DeletedFileSnapshot {
  id: string;
  filename: string;
  content: string;
  fileType: string;
  createdAt: string;
  updatedAt: string;
  geometry?: Record<string, unknown>;
  screenMetadata?: Record<string, unknown>;
  localhostScreen?: Record<string, unknown>;
  variantMemberships?: {
    setId: string;
    set: Record<string, unknown>;
    screen: unknown;
    index: number;
    originalScreenIds: string[];
  }[];
}

function deletedFileMetadataSnapshot(
  data: Record<string, unknown>,
  fileId: string,
): Pick<
  DeletedFileSnapshot,
  "geometry" | "screenMetadata" | "localhostScreen" | "variantMemberships"
> {
  const canvasFrames = isRecord(data.canvasFrames)
    ? data.canvasFrames[fileId]
    : undefined;
  const screenMetadata = isRecord(data.screenMetadata)
    ? data.screenMetadata[fileId]
    : undefined;
  const localhostScreen = isRecord(data.localhostScreens)
    ? data.localhostScreens[fileId]
    : undefined;
  const variantMemberships: NonNullable<
    DeletedFileSnapshot["variantMemberships"]
  > = [];

  if (isRecord(data.designVariantSets)) {
    for (const [setId, rawSet] of Object.entries(data.designVariantSets)) {
      if (!isRecord(rawSet) || !Array.isArray(rawSet.screens)) continue;
      const screens: unknown[] = rawSet.screens;
      const screenIds = screens.map((screen) =>
        typeof screen === "string"
          ? screen
          : isRecord(screen) && typeof screen.id === "string"
            ? screen.id
            : null,
      );
      if (screenIds.some((id) => id === null)) continue;
      screens.forEach((screen, index) => {
        if (screenIds[index] !== fileId) return;
        variantMemberships.push({
          setId,
          set: {
            ...rawSet,
            screens: screens.map((member) =>
              isRecord(member) ? { ...member } : member,
            ),
          },
          screen,
          index,
          originalScreenIds: screenIds as string[],
        });
      });
    }
  }

  return {
    ...(isRecord(canvasFrames) ? { geometry: { ...canvasFrames } } : {}),
    ...(isRecord(screenMetadata)
      ? { screenMetadata: { ...screenMetadata } }
      : {}),
    ...(isRecord(localhostScreen)
      ? { localhostScreen: { ...localhostScreen } }
      : {}),
    ...(variantMemberships.length > 0 ? { variantMemberships } : {}),
  };
}

function snapshotDeletedFile(
  file: {
    id: string;
    filename: string;
    content: string;
    fileType: string;
    createdAt: string | null;
    updatedAt: string | null;
  },
  data: Record<string, unknown>,
): DeletedFileSnapshot {
  return {
    id: file.id,
    filename: file.filename,
    content: file.content,
    fileType: file.fileType,
    createdAt: file.createdAt ?? "",
    updatedAt: file.updatedAt ?? "",
    ...deletedFileMetadataSnapshot(data, file.id),
  };
}

/**
 * Delete every file saved under one operation-source prefix (an aborted
 * browser import) and its canvas metadata in one transaction. Idempotent.
 */
export async function deleteDesignFilesByOperationSourcePrefix(
  designId: string,
  prefix: string,
): Promise<string[]> {
  await assertAccess("design", designId, "editor");
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${designSourceMutationLockKey(designId)}, 0::bigint))`,
    );
    const deleted = await tx
      .delete(schema.designFiles)
      .where(
        and(
          eq(schema.designFiles.designId, designId),
          like(
            schema.designFiles.contentOperationSource,
            `${prefix.replace(/[\\%_]/g, "\\$&")}%`,
          ),
        ),
      )
      .returning({ id: schema.designFiles.id });
    if (deleted.length === 0) return [];
    const [design] = await tx
      .select({
        data: schema.designs.data,
        updatedAt: schema.designs.updatedAt,
      })
      .from(schema.designs)
      .where(eq(schema.designs.id, designId))
      .for("update");
    if (!design) throw new Error("Design " + designId + " not found.");
    let data = parseDesignData(designId, design.data);
    for (const { id } of deleted) data = pruneDeletedFileMetadata(data, id);
    const updatedAt = nextUpdatedAt(design.updatedAt, new Date());
    data.updatedAt = updatedAt;
    await tx
      .update(schema.designs)
      .set({ data: JSON.stringify(data), updatedAt })
      .where(eq(schema.designs.id, designId));
    return deleted.map(({ id }) => id);
  });
}

export default defineAction({
  description:
    "Delete one or more files from a design project. Idempotent: if a file is already gone, returns deleted=false so cleanup retries can continue. Validates ownership via the parent design's access when the file exists.",
  schema: z.object({
    id: z.string().describe("File ID to delete"),
    fileIds: z
      .array(z.string())
      .max(100)
      .optional()
      .describe("Additional file IDs to delete in the same transaction."),
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
        "Legacy frontend checkpoint to validate before a delete; the live pre-delete version is always captured in the delete transaction.",
      ),
  }),
  run: async (
    { id, fileIds, allowLockedLayers, historyCheckpointId },
    context,
  ) => {
    const db = getDb();
    const requestedIds = [...new Set([id, ...(fileIds ?? [])])];

    // Look up the files to get their designId for access checks.
    const scopedFiles = await db
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
          requestedIds.length === 1
            ? eq(schema.designFiles.id, requestedIds[0]!)
            : inArray(schema.designFiles.id, requestedIds),
          accessFilter(schema.designs, schema.designShares),
        ),
      )
      .limit(requestedIds.length);

    const file = scopedFiles.find((candidate) => candidate.id === id);

    if (!file) {
      if (requestedIds.length > 1) {
        throw new Error(
          "One or more selected screens are no longer available. Refresh and try again.",
        );
      }
      return { id, deleted: false, alreadyMissing: true };
    }

    if (requestedIds.length > 1 && scopedFiles.length !== requestedIds.length) {
      throw new Error(
        "One or more selected screens are no longer available. Refresh and try again.",
      );
    }

    if (scopedFiles.some((candidate) => candidate.designId !== file.designId)) {
      throw new Error(
        "All files in one delete must belong to the same design.",
      );
    }

    await assertAccess("design", file.designId, "editor");
    // Locks exist to stop an agent destroying template branding in passing.
    // A person deleting their own screen has already decided, and every
    // template-backed screen carries locked layers — without this opt-in they
    // could not be removed at all.
    if (!allowLockedLayers) {
      for (const candidate of scopedFiles) {
        if (countLockedLayers(candidate.content) > 0) {
          throw new Error(
            "This screen contains locked layers. Unlock them before deleting the screen, or pass allowLockedLayers when the user asked for the whole screen to go.",
          );
        }
      }
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
    const deletion: {
      deletedIds: string[];
      deletedFiles: DeletedFileSnapshot[];
      snapshotBlobHandles: (string | null)[];
    } = await withDesignVersionLock(file.designId, async () => {
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${designSourceMutationLockKey(file.designId)}, 0::bigint))`,
        );
        await lockDesignFilesTable(tx);
        const currentFiles = await tx
          .select({
            id: schema.designFiles.id,
            filename: schema.designFiles.filename,
            content: schema.designFiles.content,
            fileType: schema.designFiles.fileType,
            createdAt: schema.designFiles.createdAt,
            updatedAt: schema.designFiles.updatedAt,
          })
          .from(schema.designFiles)
          .where(eq(schema.designFiles.designId, file.designId))
          .for("update");
        const currentTargetFiles = currentFiles.filter((candidate) =>
          requestedIds.includes(candidate.id),
        );
        if (currentTargetFiles.length !== requestedIds.length) {
          if (requestedIds.length === 1) {
            return {
              deletedIds: [],
              deletedFiles: [],
              snapshotBlobHandles: [],
            };
          }
          throw new Error(
            "A selected screen changed while it was being deleted. Refresh and try again.",
          );
        }
        if (!currentTargetFiles.length) {
          return {
            deletedIds: [],
            deletedFiles: [],
            snapshotBlobHandles: [],
          };
        }
        const [design] = await tx
          .select({
            id: schema.designs.id,
            data: schema.designs.data,
            updatedAt: schema.designs.updatedAt,
            ownerEmail: schema.designs.ownerEmail,
            orgId: schema.designs.orgId,
            visibility: schema.designs.visibility,
          })
          .from(schema.designs)
          .where(eq(schema.designs.id, file.designId))
          .for("update");
        if (!design) throw new Error("Design " + file.designId + " not found.");
        await tx
          .select({ id: schema.designShares.id })
          .from(schema.designShares)
          .where(eq(schema.designShares.resourceId, file.designId))
          .for("update");
        const access = currentAccess();
        const memberEmail = access.userEmail?.trim().toLowerCase();
        const ownerEmail = design.ownerEmail?.trim().toLowerCase();
        if (
          design.visibility === "org" &&
          design.orgId &&
          memberEmail &&
          memberEmail !== ownerEmail
        ) {
          try {
            await tx
              .select({ id: orgMembers.id })
              .from(orgMembers)
              .where(
                and(
                  eq(orgMembers.orgId, design.orgId),
                  sql`lower(${orgMembers.email}) = ${memberEmail}`,
                ),
              )
              .for("update");
          } catch (error) {
            // Embedded deployments may omit the org module. Let the shared
            // access resolver decide whether a direct share still applies;
            // org visibility itself remains fail-closed without membership.
            if (!isMissingOrganizationTableError(error)) throw error;
          }
        }
        const transactionAccess = {
          ...access,
          transaction: {
            async execute(statement: DbExecStatement) {
              return normalizeDrizzleExecResult(
                await tx.execute(drizzleSqlForAccess(statement)),
              );
            },
          },
        };
        await assertAccess(
          "design",
          file.designId,
          "editor",
          transactionAccess,
        );
        if (!allowLockedLayers) {
          for (const candidate of currentTargetFiles) {
            if (countLockedLayers(candidate.content) > 0) {
              throw new Error(
                "This screen contains locked layers. Unlock them before deleting the screen, or pass allowLockedLayers when the user asked for the whole screen to go.",
              );
            }
          }
        }
        const currentUserScreenCount =
          currentFiles.filter(isOverviewScreenFile).length;
        const deletingUserScreenCount =
          currentTargetFiles.filter(isOverviewScreenFile).length;
        if (currentUserScreenCount - deletingUserScreenCount <= 0) {
          throw new Error(
            "A design must keep at least one user screen. Delete another screen first.",
          );
        }
        let data = parseDesignData(file.designId, design.data);
        const deletedFiles = currentTargetFiles.map((candidate) =>
          snapshotDeletedFile(candidate, data),
        );
        // A browser checkpoint may have been created by an older client before
        // this request arrived. Capture again here so that any edit between
        // those requests is included in the durable pre-delete version.
        await snapshotDesignBeforeAgentEditInVersionLock(
          file.designId,
          context,
          tx,
        );

        const targetIds = currentTargetFiles.map((candidate) => candidate.id);
        const snapshotRows = await tx
          .select({
            blobHandle: schema.designVisualEditSnapshots.blobHandle,
          })
          .from(schema.designVisualEditSnapshots)
          .where(
            and(
              eq(schema.designVisualEditSnapshots.designId, file.designId),
              inArray(schema.designVisualEditSnapshots.fileId, targetIds),
            ),
          )
          .for("update");
        await queueVisualEditSnapshotBlobCleanupInTransaction(
          tx,
          snapshotRows.map((row) => row.blobHandle),
        );
        const deleteResult = await tx
          .delete(schema.designFiles)
          .where(
            and(
              targetIds.length === 1
                ? eq(schema.designFiles.id, targetIds[0]!)
                : inArray(schema.designFiles.id, targetIds),
              eq(schema.designFiles.designId, file.designId),
            ),
          );
        const affected = affectedRowCount(deleteResult);
        if (affected === 0) {
          if (requestedIds.length === 1) {
            return {
              deletedIds: [],
              deletedFiles: [],
              snapshotBlobHandles: [],
            };
          }
          throw new Error(
            "A selected screen changed while it was being deleted. Refresh and try again.",
          );
        }
        if (affected === undefined)
          throw new Error("Could not verify that the design file was deleted.");
        if (affected !== targetIds.length)
          throw new Error("Unexpected design file delete result.");

        const updatedAt = nextUpdatedAt(design.updatedAt, new Date());
        for (const targetId of targetIds) {
          data = pruneDeletedFileMetadata(data, targetId);
        }
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
        return {
          deletedIds: targetIds,
          deletedFiles,
          snapshotBlobHandles: snapshotRows.map((row) => row.blobHandle),
        };
      });
    });

    if (deletion.deletedIds.length > 0) {
      await deleteVisualEditSnapshotBlobs(deletion.snapshotBlobHandles);
    }

    if (requestedIds.length === 1) {
      return deletion.deletedIds.includes(id)
        ? { id, deleted: true, deletedFiles: deletion.deletedFiles }
        : { id, deleted: false, alreadyMissing: true };
    }
    return {
      id,
      deleted: deletion.deletedIds.includes(id),
      deletedIds: deletion.deletedIds,
      ...(deletion.deletedIds.includes(id)
        ? { deletedFiles: deletion.deletedFiles }
        : { alreadyMissing: true }),
    };
  },
});
