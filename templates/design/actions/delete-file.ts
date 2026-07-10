import { defineAction } from "@agent-native/core";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { mutateDesignData } from "../server/lib/design-data-mutation.js";

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

export default defineAction({
  description:
    "Delete a file from a design project. Idempotent: if the file is already gone, returns deleted=false so cleanup retries can continue. Validates ownership via the parent design's access when the file exists.",
  schema: z.object({
    id: z.string().describe("File ID to delete"),
  }),
  run: async ({ id }) => {
    const db = getDb();

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

    if (!file) return { id, deleted: false, alreadyMissing: true };

    await assertAccess("design", file.designId, "editor");

    const pruneMetadata = () =>
      mutateDesignData({
        designId: file.designId,
        mutate: (current, { updatedAt }) => ({
          ...pruneDeletedFileMetadata(current, id),
          updatedAt,
        }),
        isApplied: (current) =>
          JSON.stringify(pruneDeletedFileMetadata(current, id)) ===
          JSON.stringify(current),
      });

    // Prune before deletion so a retry never loses the parent design id, then
    // prune once more after deletion to close the small window where another
    // editor could have refreshed metadata for the still-existing file.
    await pruneMetadata();
    await db.delete(schema.designFiles).where(eq(schema.designFiles.id, id));
    await pruneMetadata();

    return { id, deleted: true };
  },
});
