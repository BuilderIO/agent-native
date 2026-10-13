export type NativePipelineInvalidationReason = "reset" | "evicted";

export class NativePipelineCacheInvalidatedError extends Error {
  readonly code = "native_pipeline_cache_invalidated";

  constructor(readonly reason: NativePipelineInvalidationReason) {
    super(`Native pipeline compilation was invalidated by ${reason}.`);
    this.name = "NativePipelineCacheInvalidatedError";
  }
}

export class NativePipelineCacheCapacityError extends Error {
  readonly code = "native_pipeline_cache_capacity";

  constructor() {
    super("Active native pipelines exceed the bounded cache capacity.");
    this.name = "NativePipelineCacheCapacityError";
  }
}

interface CacheEntry<T> {
  promise: Promise<T>;
  invalidate: (reason: NativePipelineInvalidationReason) => void;
}

export class NativePipelineCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly pins = new Map<string, number>();
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

  pin(key: string): () => void {
    const count = this.pins.get(key) ?? 0;
    if (count === 0 && this.pins.size >= 256)
      throw new NativePipelineCacheCapacityError();
    if (!Number.isSafeInteger(count + 1))
      throw new NativePipelineCacheCapacityError();
    this.pins.set(key, count + 1);
    const generation = this.generation;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (generation !== this.generation) return;
      const remaining = this.pins.get(key);
      if (remaining === 1) this.pins.delete(key);
      else if (remaining !== undefined) this.pins.set(key, remaining - 1);
      this.trim();
    };
  }

  private evict(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    entry.invalidate("evicted");
  }

  private oldestUnpinned(protectedKey?: string): string | undefined {
    for (const key of this.entries.keys())
      if (!this.pins.has(key) && key !== protectedKey) return key;
    return undefined;
  }

  private trim(protectedKey?: string): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.oldestUnpinned(protectedKey);
      if (oldest === undefined) break;
      this.evict(oldest);
    }
  }

  getOrCreate(key: string, factory: () => Promise<T>): Promise<T> {
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.promise;
    }

    if (this.entries.size >= 256) {
      const oldest = this.oldestUnpinned();
      if (oldest === undefined) throw new NativePipelineCacheCapacityError();
      this.evict(oldest);
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
    this.trim(key);

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
    this.pins.clear();
  }
}
