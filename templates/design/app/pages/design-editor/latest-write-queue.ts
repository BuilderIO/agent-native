export interface LatestWriteQueue<T> {
  enqueue(value: T): void;
  hasPending(): boolean;
  whenIdle(): Promise<void>;
}

export function createLatestWriteQueue<T>(
  write: (value: T) => Promise<unknown>,
  onError?: (error: unknown) => void,
): LatestWriteQueue<T> {
  let latest: T | undefined;
  let drainPromise: Promise<void> | null = null;

  const drain = async () => {
    while (latest !== undefined) {
      const value = latest;
      latest = undefined;
      try {
        await write(value);
      } catch (error) {
        try {
          onError?.(error);
        } catch {
          // Error reporting must never strand a newer queued write.
        }
      }
    }
  };

  const startDrain = () => {
    if (drainPromise) return;
    drainPromise = drain().finally(() => {
      drainPromise = null;
      if (latest !== undefined) startDrain();
    });
  };

  return {
    enqueue(value) {
      latest = value;
      startDrain();
    },
    hasPending() {
      return drainPromise !== null || latest !== undefined;
    },
    async whenIdle() {
      while (drainPromise) await drainPromise;
    },
  };
}
