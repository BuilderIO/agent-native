export type DashboardSaveResult = {
  isLatest: boolean;
};

/**
 * Full-config dashboard saves must stay ordered. Each interaction derives a
 * complete config, so an older request completing last would otherwise write
 * its stale panel list back over a newer edit.
 */
export function createDashboardSaveQueue<T>(
  save: (config: T) => Promise<void>,
): { enqueue(config: T): Promise<DashboardSaveResult> } {
  let pendingCount = 0;
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue(config) {
      pendingCount += 1;
      const saveResult = tail.then(async () => {
        try {
          await save(config);
          return { isLatest: pendingCount === 1 };
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
  };
}
