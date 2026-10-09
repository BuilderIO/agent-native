import type { RecurringSweepContext } from "@agent-native/core/server";
import { and, inArray, lt, sql } from "drizzle-orm";

import {
  JOURNEY_STAGED_REPLAY_MAX_AGE_MS,
  JOURNEY_STAGED_REPLAY_ROW_PREFIX,
} from "../../shared/journey-canvas.js";
import { getDb, schema } from "../db/index.js";
import {
  deleteVisualEditSnapshotBlobs,
  queueVisualEditSnapshotBlobCleanupInTransaction,
} from "./visual-edit-snapshot-blobs.js";

const CLEANUP_BATCH_SIZE = 100;
const STAGED_ID_PREDICATE = sql.raw(
  `starts_with(id, '${JOURNEY_STAGED_REPLAY_ROW_PREFIX}')`,
);

export async function sweepExpiredJourneyCanvasStages(
  signal?: AbortSignal,
): Promise<{
  rowsRemoved: number;
  blobsQueued: number;
  cleanupPending: boolean;
}> {
  signal?.throwIfAborted();
  const table = schema.designBoardReplayScreenshots;
  const cutoff = new Date(
    Date.now() - JOURNEY_STAGED_REPLAY_MAX_AGE_MS,
  ).toISOString();
  const removed = await getDb().transaction(async (tx) => {
    const expired = await tx
      .select({ id: table.id, blobHandle: table.blobHandle })
      .from(table)
      .where(and(lt(table.createdAt, cutoff), STAGED_ID_PREDICATE))
      .orderBy(table.createdAt, table.id)
      .limit(CLEANUP_BATCH_SIZE)
      .for("update", { skipLocked: true });
    if (!expired.length) return { rowsRemoved: 0, blobsQueued: 0 };

    signal?.throwIfAborted();
    await tx.delete(table).where(
      inArray(
        table.id,
        expired.map(({ id }) => id),
      ),
    );

    const handles = [...new Set(expired.map(({ blobHandle }) => blobHandle))];
    const remainingReferences = await tx
      .select({ blobHandle: table.blobHandle })
      .from(table)
      .where(inArray(table.blobHandle, handles));
    const referenced = new Set(
      remainingReferences.map(({ blobHandle }) => blobHandle),
    );
    const orphaned = handles.filter((handle) => !referenced.has(handle));
    await queueVisualEditSnapshotBlobCleanupInTransaction(tx, orphaned);
    signal?.throwIfAborted();
    return { rowsRemoved: expired.length, blobsQueued: orphaned.length };
  });

  signal?.throwIfAborted();
  const cleanupPending = await deleteVisualEditSnapshotBlobs([]);
  return { ...removed, cleanupPending };
}

export async function runJourneyCanvasStageCleanupSweep(
  context: RecurringSweepContext,
): Promise<void> {
  await sweepExpiredJourneyCanvasStages(context.signal);
}
