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

export type DashboardSaveResult<T> = DashboardSaveOutcome & {
  isLatest: boolean;
  /** The config this save actually sent, after rebasing queued edits. */
  config: T;
};

export class DashboardSaveQueueConflictError extends Error {
  constructor(message = "Dashboard changed while a save was pending.") {
    super(message);
    this.name = "DashboardSaveQueueConflictError";
  }
}

export type DashboardSaveQueue<T> = {
  /**
   * `baseUpdatedAt` is the version the config was edited from: the one on
   * screen when the save was made.
   */
  enqueue(
    config: T,
    baseUpdatedAt: string | null,
    update?: (current: T) => T,
    baseConfig?: T,
  ): Promise<DashboardSaveResult<T>>;
  /** Saves queued and not yet settled. */
  pending(): number;
  /** The latest config confirmed by a successful save or authoritative load. */
  confirmed(): T | undefined;
};

/**
 * Runs saves one at a time, each fenced to the version its config was edited
 * from. Queued updates are replayed against the latest confirmed config when
 * they belong to the same version chain, so a later edit does not carry a
 * failed earlier edit. A queued edit adopted from another version is rejected
 * when it reaches the save, instead of sending its captured config over a
 * newer confirmed version.
 */
export function createDashboardSaveQueue<T>(
  save: (
    config: T,
    expectedUpdatedAt: string | undefined,
  ) => Promise<DashboardSaveOutcome>,
): DashboardSaveQueue<T> {
  const waiting = new Set<{ base: string | null; diverged: boolean }>();
  let tail: Promise<void> = Promise.resolve();
  let confirmedConfig: T | undefined;
  let confirmedVersion: string | null | undefined;
  let hasConfirmedConfig = false;
  let latestQueuedConfig: T | undefined;
  let hasLatestQueuedConfig = false;
  let queuedChainDiverged = false;
  let previousSaveFailed = false;

  return {
    enqueue(config, baseUpdatedAt, update, baseConfig) {
      if (waiting.size === 0) {
        const needsNewBase =
          !previousSaveFailed ||
          !hasConfirmedConfig ||
          baseUpdatedAt !== confirmedVersion;
        if (baseConfig !== undefined && needsNewBase) {
          confirmedConfig = baseConfig;
          confirmedVersion = baseUpdatedAt;
          hasConfirmedConfig = true;
        }
        queuedChainDiverged = false;
        previousSaveFailed = false;
      } else if (
        baseConfig !== undefined &&
        hasLatestQueuedConfig &&
        baseConfig !== latestQueuedConfig
      ) {
        queuedChainDiverged = true;
      }
      if (!hasConfirmedConfig && baseConfig !== undefined) {
        confirmedConfig = baseConfig;
        confirmedVersion = baseUpdatedAt;
        hasConfirmedConfig = true;
      }
      const entry = { base: baseUpdatedAt, diverged: queuedChainDiverged };
      waiting.add(entry);
      latestQueuedConfig = config;
      hasLatestQueuedConfig = true;
      const saveResult = tail.then(async () => {
        let outcome: DashboardSaveOutcome;
        let configToSave = config;
        let succeeded = false;
        try {
          if (entry.diverged) {
            throw new DashboardSaveQueueConflictError();
          }
          if (
            update &&
            hasConfirmedConfig &&
            !entry.diverged &&
            entry.base === confirmedVersion
          ) {
            configToSave = update(confirmedConfig as T);
          }
          outcome = await save(configToSave, entry.base ?? undefined);
          succeeded = true;
        } finally {
          waiting.delete(entry);
          previousSaveFailed = !succeeded;
        }
        confirmedConfig = configToSave;
        confirmedVersion = outcome.updatedAt ?? entry.base;
        hasConfirmedConfig = true;
        if (outcome.updatedAt) {
          for (const later of waiting) {
            if (later.base === entry.base) later.base = outcome.updatedAt;
          }
        }
        return {
          ...outcome,
          isLatest: waiting.size === 0,
          config: configToSave,
        };
      });
      tail = saveResult.then(
        () => undefined,
        () => undefined,
      );
      return saveResult;
    },
    pending: () => waiting.size,
    confirmed: () => confirmedConfig,
  };
}
