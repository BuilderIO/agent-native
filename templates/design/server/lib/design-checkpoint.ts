/**
 * Shared design-checkpoint helpers for create-design-checkpoint and
 * restore-design-version. A checkpoint is a `design_versions` row whose
 * `snapshot` captures the full current file set.
 */

import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "../db/index.js";
import {
  DEFAULT_CHECKPOINT_KEEP,
  selectCheckpointsToPrune,
} from "./checkpoint-pruning.js";

export interface CheckpointSnapshotFile {
  id: string;
  filename: string;
  content: string;
  fileType?: string;
  bytes?: number;
}

/** Snapshot every file of a design into a new `design_versions` row. When
 * `prune` is set, auto-created checkpoints of the same `kind` beyond the newest
 * N are pruned. */
export async function writeDesignCheckpoint(opts: {
  designId: string;
  kind: string;
  createdBy: string;
  trigger?: string | null;
  label?: string | null;
  prune?: boolean;
}): Promise<{ versionId: string; filesCaptured: number; pruned: number }> {
  const db = getDb();
  const files = await db
    .select({
      id: schema.designFiles.id,
      filename: schema.designFiles.filename,
      content: schema.designFiles.content,
      fileType: schema.designFiles.fileType,
    })
    .from(schema.designFiles)
    .where(eq(schema.designFiles.designId, opts.designId));
  const now = new Date().toISOString();
  const versionId = `dv_${nanoid(12)}`;
  const snapshot = JSON.stringify({
    designId: opts.designId,
    snapshotKind: opts.kind,
    files: files.map((file) => ({
      id: file.id,
      filename: file.filename,
      content: file.content,
      fileType: file.fileType ?? "html",
      bytes: file.content?.length ?? 0,
    })),
    capturedAt: now,
  });
  await db.insert(schema.designVersions).values({
    id: versionId,
    designId: opts.designId,
    label: opts.label ?? `${opts.kind} checkpoint — ${now}`,
    snapshot,
    createdBy: opts.createdBy,
    kind: opts.kind,
    trigger: opts.trigger ?? null,
    createdAt: now,
  });
  let pruned = 0;
  if (opts.prune) {
    const rows = await db
      .select({
        id: schema.designVersions.id,
        kind: schema.designVersions.kind,
        createdAt: schema.designVersions.createdAt,
      })
      .from(schema.designVersions)
      .where(eq(schema.designVersions.designId, opts.designId));
    const toPrune = selectCheckpointsToPrune(
      rows,
      opts.kind,
      DEFAULT_CHECKPOINT_KEEP,
    );
    if (toPrune.length > 0) {
      await db
        .delete(schema.designVersions)
        .where(inArray(schema.designVersions.id, toPrune));
      pruned = toPrune.length;
    }
  }
  return { versionId, filesCaptured: files.length, pruned };
}

/** Pure: extract the restorable file entries from a snapshot JSON string. */
export function parseCheckpointSnapshotFiles(
  snapshot: string,
): CheckpointSnapshotFile[] {
  try {
    const parsed = JSON.parse(snapshot) as { files?: unknown };
    if (!Array.isArray(parsed.files)) return [];
    return parsed.files.filter(
      (file): file is CheckpointSnapshotFile =>
        !!file &&
        typeof file === "object" &&
        typeof (file as { id?: unknown }).id === "string" &&
        typeof (file as { content?: unknown }).content === "string" &&
        typeof (file as { filename?: unknown }).filename === "string",
    );
  } catch {
    return [];
  }
}
