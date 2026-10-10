export type NativePipelineInvalidationReason = "reset" | "evicted";

export class NativePipelineCacheInvalidatedError extends Error {
  readonly code = "native_pipeline_cache_invalidated";

  constructor(readonly reason: NativePipelineInvalidationReason) {
    super(`Native pipeline compilation was invalidated by ${reason}.`);
    this.name = "NativePipelineCacheInvalidatedError";
  }
}

interface CacheEntry<T> {
  promise: Promise<T>;
  invalidate: (reason: NativePipelineInvalidationReason) => void;
}

export class NativePipelineCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private generation = 0;

  constructor(readonly maxEntries = 32) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 256)
      throw new RangeError("maxEntries must be an integer from 1 to 256");
  }

  get size(): number {
    return this.entries.size;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  getOrCreate(key: string, factory: () => Promise<T>): Promise<T> {
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.promise;
    }

    const generation = this.generation;
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    let settled = false;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const entry: CacheEntry<T> = {
      promise,
      invalidate: (reason) => {
        if (settled) return;
        settled = true;
        reject(new NativePipelineCacheInvalidatedError(reason));
      },
    };
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.entries.get(oldestKey)!;
      this.entries.delete(oldestKey);
      oldest.invalidate("evicted");
    }

    void Promise.resolve().then(async () => {
      if (settled) return;
      try {
        const value = await factory();
        if (settled) return;
        if (generation !== this.generation || this.entries.get(key) !== entry) {
          entry.invalidate("reset");
          return;
        }
        settled = true;
        resolve(value);
      } catch (error) {
        if (settled) return;
        if (generation !== this.generation || this.entries.get(key) !== entry) {
          entry.invalidate("reset");
          return;
        }
        settled = true;
        reject(error);
      }
    });
    return promise;
  }

  reset(): void {
    this.generation++;
    for (const entry of this.entries.values()) entry.invalidate("reset");
    this.entries.clear();
  }
}
