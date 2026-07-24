/**
 * Bounded auto-pruning for auto-created design checkpoints: keep only the
 * newest N per design of a given kind. Never prunes manual/user snapshots.
 * Pure so the selection rule is unit-tested without a database.
 */

export interface PrunableCheckpointRow {
  id: string;
  kind: string | null;
  createdAt: string | null;
}

/** The default retention for auto-created `pre-agent-run` checkpoints. */
export const DEFAULT_CHECKPOINT_KEEP = 20;

/** Returns ids of `kind` checkpoints outside the newest `keepNewest` (by ISO
 * `createdAt`). Other kinds and null-kind rows are never selected; ties break
 * by id descending for determinism. */
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
