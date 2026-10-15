export type DashboardSaveResult = {
  isLatest: boolean;
  /** False when the dashboard already matched and the server wrote nothing. */
  changed: boolean;
};

export type DashboardSaveQueue<T> = {
  enqueue(config: T): Promise<DashboardSaveResult>;
  /** Saves queued and not yet settled. */
  pending(): number;
};

export function createDashboardSaveQueue<T>(
  save: (config: T) => Promise<{ changed: boolean }>,
): DashboardSaveQueue<T> {
  let pendingCount = 0;
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue(config) {
      pendingCount += 1;
      const saveResult = tail.then(async () => {
        try {
          const { changed } = await save(config);
          return { isLatest: pendingCount === 1, changed };
        } finally {
          pendingCount -= 1;
        }
      });
      tail = saveResult.then(
        () => undefined,
        () => undefined,
      );
      return saveResult;
    },
    pending: () => pendingCount,
  };
}
