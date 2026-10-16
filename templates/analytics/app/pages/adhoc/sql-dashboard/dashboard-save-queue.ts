import type { DashboardChange } from "@shared/dashboard-change-summary";

export type DashboardSaveOutcome = {
  /** False when the dashboard already matched and the server wrote nothing. */
  changed: boolean;
  /** The dashboard's version after the save, when the server reported it. */
  updatedAt?: string;
  /** The revision holding the dashboard as it was before the save, when it wrote. */
  revisionId?: string;
  /** What the save changed, as history records it on `revisionId`. */
  changes?: DashboardChange[];
  /** Changes left out of `changes` by history's cap. */
  omittedChanges?: number;
};

export type DashboardSaveResult = DashboardSaveOutcome & { isLatest: boolean };

export type DashboardSaveQueue<T> = {
  /**
   * `baseUpdatedAt` is the version the config was edited from: the one on
   * screen when the save was made.
   */
  enqueue(
    config: T,
    baseUpdatedAt: string | null,
  ): Promise<DashboardSaveResult>;
  /** Saves queued and not yet settled. */
  pending(): number;
};

/**
 * Runs saves one at a time, each fenced to the version its config was edited
 * from. A save queued from the same version as an earlier one carries that
 * one's edit too, so when the earlier save lands, its version becomes the
 * later save's base. Nothing else moves a base: an edit adopted from someone
 * else after a save was queued isn't in its config, so that save must fail
 * rather than overwrite it.
 */
export function createDashboardSaveQueue<T>(
  save: (
    config: T,
    expectedUpdatedAt: string | undefined,
  ) => Promise<DashboardSaveOutcome>,
): DashboardSaveQueue<T> {
  const waiting = new Set<{ base: string | null }>();
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue(config, baseUpdatedAt) {
      const entry = { base: baseUpdatedAt };
      waiting.add(entry);
      const saveResult = tail.then(async () => {
        let outcome: DashboardSaveOutcome;
        try {
          outcome = await save(config, entry.base ?? undefined);
        } finally {
          waiting.delete(entry);
        }
        if (outcome.updatedAt) {
          for (const later of waiting) {
            if (later.base === entry.base) later.base = outcome.updatedAt;
          }
        }
        return { ...outcome, isLatest: waiting.size === 0 };
      });
      tail = saveResult.then(
        () => undefined,
        () => undefined,
      );
      return saveResult;
    },
    pending: () => waiting.size,
  };
}
