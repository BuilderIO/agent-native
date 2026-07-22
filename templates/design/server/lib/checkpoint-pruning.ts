/**
 * Task 5a — bounded auto-pruning for automatically-created design checkpoints.
 *
 * `pre-agent-run` and other auto-created checkpoints accumulate one row per
 * trigger. We keep only the newest N per design *of that kind* and delete the
 * rest. Pruning is a delete of rows the framework created automatically
 * (bounded, additive-safe) — never of manual/user snapshots. Pure so the
 * selection rule is unit-tested without a database.
 */

export interface PrunableCheckpointRow {
  id: string;
  kind: string | null;
  createdAt: string | null;
}

/** The default retention for auto-created `pre-agent-run` checkpoints. */
export const DEFAULT_CHECKPOINT_KEEP = 20;

/**
 * Returns the ids of checkpoints of `kind` that fall outside the newest
 * `keepNewest` (by ISO `createdAt`, newest first). Rows of other kinds and
 * rows with a null kind are never selected. Ties break by id descending so the
 * result is deterministic when timestamps collide.
 */
export function selectCheckpointsToPrune(
  rows: readonly PrunableCheckpointRow[],
  kind: string,
  keepNewest: number = DEFAULT_CHECKPOINT_KEEP,
): string[] {
  if (keepNewest < 0) keepNewest = 0;
  const ofKind = rows
    .filter((row) => row.kind === kind)
    .sort((a, b) => {
      const at = a.createdAt ?? "";
      const bt = b.createdAt ?? "";
      if (at !== bt) return bt.localeCompare(at);
      return b.id.localeCompare(a.id);
    });
  return ofKind.slice(keepNewest).map((row) => row.id);
}
