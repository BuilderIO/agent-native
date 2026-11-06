export const SOURCE_HYDRATION_MAX_BYTES = 16 * 1024 * 1024;
const EAGER_SOURCE_MAX_BYTES = 4 * 1024 * 1024;
const EAGER_SOURCE_MAX_FILES = 64;

/** Every source of a design small enough to load whole; none otherwise. */
export function eagerSourceIds(
  files: readonly { id: string; contentBytes?: number | null }[],
): string[] {
  if (files.length > EAGER_SOURCE_MAX_FILES) return [];
  let bytes = 0;
  for (const file of files) {
    if (typeof file.contentBytes !== "number") return [];
    bytes += file.contentBytes;
  }
  return bytes <= EAGER_SOURCE_MAX_BYTES ? files.map((file) => file.id) : [];
}

export type SourceHydrationState =
  | { status: "unloaded" }
  | { status: "loading" }
  | {
      status: "ready";
      content: string;
      updatedAt: string;
      refreshing?: boolean;
      refreshError?: unknown;
    }
  | { status: "error"; error: unknown };

export interface SourceHydrationFile {
  id: string;
  updatedAt: string;
}

export type SourceHydrationRead = (
  id: string,
) => Promise<{ content: string; updatedAt: string }>;

/** Keeps unrequested, failed, and genuinely empty source distinct. */
export class SourceHydration {
  private readonly states = new Map<string, SourceHydrationState>();
  private readonly versions = new Map<string, string>();
  private readonly lru = new Map<string, number>();
  private pinned = new Set<string>();
  private readonly leases = new Map<string, number>();
  private dirty = new Set<string>();
  private readonly needsRefresh = new Set<string>();
  private readonly primedBeforeMetadata = new Set<string>();
  private readyBytes = 0;
  private readonly pending = new Map<string, Promise<void>>();
  private readonly queue: Array<{ start: () => void; cancel: () => void }> = [];
  private active = 0;
  private disposed = false;

  constructor(
    private readonly read: SourceHydrationRead,
    private readonly changed: () => void,
    private readonly concurrency = 4,
    private readonly maxBytes = SOURCE_HYDRATION_MAX_BYTES,
  ) {}

  sync(files: readonly SourceHydrationFile[]): void {
    const ids = new Set(files.map((file) => file.id));
    let invalidated = false;
    for (const id of this.versions.keys()) {
      if (ids.has(id)) {
        this.primedBeforeMetadata.delete(id);
      } else if (!this.primedBeforeMetadata.has(id)) {
        this.versions.delete(id);
        this.removeReady(id);
        invalidated = this.states.delete(id) || invalidated;
      }
    }
    for (const file of files) {
      const previous = this.versions.get(file.id);
      this.versions.set(file.id, file.updatedAt);
      if (previous !== undefined && previous !== file.updatedAt) {
        invalidated = this.invalidate(file.id) || invalidated;
      }
    }
    if (invalidated) this.changed();
  }

  /** Seeds source the editor just wrote, so a created screen is usable at once. */
  prime(id: string, file: { content: string; updatedAt: string }): void {
    if (this.disposed) return;
    if (!this.versions.has(id)) this.primedBeforeMetadata.add(id);
    this.versions.set(id, file.updatedAt);
    this.needsRefresh.delete(id);
    this.removeReady(id);
    this.states.set(id, { status: "ready", ...file });
    const bytes = new TextEncoder().encode(file.content).byteLength;
    this.lru.set(id, bytes);
    this.readyBytes += bytes;
    this.evict();
    this.changed();
  }

  // A held source keeps its last version while the new one loads; dropping it
  // unmounts the screen's preview and blanks the frame.
  private invalidate(id: string): boolean {
    const state = this.states.get(id);
    if (state?.status === "ready" && this.isHeld(id)) {
      this.needsRefresh.add(id);
      if (!state.refreshing)
        this.states.set(id, { ...state, refreshing: true });
      return true;
    }
    this.needsRefresh.delete(id);
    this.removeReady(id);
    return this.states.delete(id);
  }

  private isHeld(id: string): boolean {
    return this.pinned.has(id) || this.dirty.has(id) || this.leases.has(id);
  }

  get(id: string): SourceHydrationState {
    const state = this.states.get(id) ?? { status: "unloaded" };
    if (state.status === "ready") {
      const size = this.lru.get(id);
      if (size !== undefined) {
        this.lru.delete(id);
        this.lru.set(id, size);
      }
    }
    return state;
  }

  setPinned(ids: ReadonlySet<string>): void {
    this.pinned = new Set(ids);
    if (this.release()) this.changed();
  }

  lease(id: string): () => void {
    this.leases.set(id, (this.leases.get(id) ?? 0) + 1);
    return () => {
      const remaining = (this.leases.get(id) ?? 1) - 1;
      if (remaining > 0) this.leases.set(id, remaining);
      else this.leases.delete(id);
      if (this.release()) this.changed();
    };
  }

  /** Drops stale sources nothing holds any more, then trims to the budget. */
  private release(): boolean {
    let released = false;
    for (const id of this.needsRefresh) {
      if (this.isHeld(id) || this.pending.has(id)) continue;
      released = this.invalidate(id) || released;
    }
    return this.evict() || released;
  }

  setDirty(ids: ReadonlySet<string>): void {
    const previous = this.dirty;
    this.dirty = new Set(ids);
    let invalidated = false;
    for (const id of previous) {
      if (this.dirty.has(id)) continue;
      const state = this.states.get(id);
      if (
        state?.status === "ready" &&
        state.updatedAt !== this.versions.get(id)
      ) {
        invalidated = this.invalidate(id) || invalidated;
      }
    }
    if (this.release() || invalidated) this.changed();
  }

  private removeReady(id: string): void {
    const size = this.lru.get(id);
    if (size !== undefined) this.readyBytes -= size;
    this.lru.delete(id);
  }

  private evict(): boolean {
    let evicted = false;
    for (const [id] of this.lru) {
      if (this.readyBytes <= this.maxBytes) break;
      if (this.isHeld(id)) continue;
      this.needsRefresh.delete(id);
      this.removeReady(id);
      this.states.delete(id);
      evicted = true;
    }
    return evicted;
  }

  request(id: string): Promise<void> {
    const existing = this.pending.get(id);
    if (existing) return existing;
    if (!this.versions.has(id) || this.disposed) return Promise.resolve();
    const previous = this.get(id);
    if (previous.status === "ready" && !this.needsRefresh.has(id))
      return Promise.resolve();
    const version = this.versions.get(id);
    this.states.set(
      id,
      previous.status === "ready"
        ? { ...previous, refreshing: true, refreshError: undefined }
        : { status: "loading" },
    );
    this.changed();
    const promise = new Promise<void>((resolve) => {
      const complete = () => {
        this.pending.delete(id);
        if (!this.disposed) this.changed();
        this.pump();
        if (
          !this.disposed &&
          this.versions.has(id) &&
          this.versions.get(id) !== version
        ) {
          void this.request(id).then(resolve);
        } else {
          resolve();
        }
      };
      this.queue.push({
        start: () => {
          if (this.versions.get(id) !== version) {
            complete();
            return;
          }
          this.active++;
          void Promise.resolve()
            .then(() => this.read(id))
            .then(
              (file) => {
                if (!this.disposed && this.versions.get(id) === version) {
                  // A read returns the current source; one newer than the
                  // metadata is the latest save, not a failed load.
                  this.versions.set(id, file.updatedAt);
                  this.removeReady(id);
                  this.needsRefresh.delete(id);
                  this.states.set(id, { status: "ready", ...file });
                  const bytes = new TextEncoder().encode(
                    file.content,
                  ).byteLength;
                  this.lru.set(id, bytes);
                  this.readyBytes += bytes;
                  this.evict();
                }
              },
              (error) => {
                if (!this.disposed && this.versions.get(id) === version) {
                  this.states.set(
                    id,
                    previous.status === "ready"
                      ? { ...previous, refreshing: false, refreshError: error }
                      : { status: "error", error },
                  );
                }
              },
            )
            .finally(() => {
              this.active--;
              complete();
            });
        },
        cancel: complete,
      });
      this.pump();
    });
    this.pending.set(id, promise);
    return promise;
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.queue.splice(0)) entry.cancel();
  }

  private pump(): void {
    while (
      !this.disposed &&
      this.active < this.concurrency &&
      this.queue.length
    ) {
      this.queue.shift()?.start();
    }
  }
}
