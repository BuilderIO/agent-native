import { useCallback, useMemo, useSyncExternalStore } from "react";

const MAX_TRACKED_SOURCES = 1_000;
const ZERO_SNAPSHOT = () => 0;

class ChangeVersionStore {
  private versions = new Map<string, number>();
  private listeners = new Map<string, Set<() => void>>();
  private activeSources = new Map<string, number>();

  bump(source: string, version: number): boolean {
    if (!source) return false;
    const current = this.versions.get(source) ?? 0;
    if (version > current) {
      this.versions.set(source, version);
      this.evictUnobservedSources();
      for (const listener of this.listeners.get(source) ?? []) listener();
      return true;
    }
    return false;
  }

  get(source: string): number {
    return this.versions.get(source) ?? 0;
  }

  subscribe(sources: readonly string[], listener: () => void): () => void {
    const uniqueSources = new Set(sources.filter(Boolean));
    for (const source of uniqueSources) {
      this.activeSources.set(source, (this.activeSources.get(source) ?? 0) + 1);
      let listeners = this.listeners.get(source);
      if (!listeners) {
        listeners = new Set();
        this.listeners.set(source, listeners);
      }
      listeners.add(listener);
    }
    return () => {
      for (const source of uniqueSources) {
        const listeners = this.listeners.get(source);
        listeners?.delete(listener);
        if (listeners?.size === 0) this.listeners.delete(source);
        const count = (this.activeSources.get(source) ?? 1) - 1;
        if (count > 0) this.activeSources.set(source, count);
        else this.activeSources.delete(source);
      }
      this.evictUnobservedSources();
    };
  }

  reset(): void {
    this.versions.clear();
    this.listeners.clear();
    this.activeSources.clear();
  }

  private evictUnobservedSources(): void {
    while (this.versions.size > MAX_TRACKED_SOURCES) {
      let evicted = false;
      for (const source of this.versions.keys()) {
        if (this.activeSources.has(source)) continue;
        this.versions.delete(source);
        evicted = true;
        break;
      }
      if (!evicted) return;
    }
  }
}

const store = new ChangeVersionStore();

export function bumpChangeVersion(source: string, version: number): boolean {
  return store.bump(source, version);
}

export function getChangeVersion(source: string): number {
  return store.get(source);
}

export function useChangeVersion(source: string): number {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe([source], listener),
    [source],
  );
  const getSnapshot = useCallback(() => store.get(source), [source]);

  return useSyncExternalStore(subscribe, getSnapshot, ZERO_SNAPSHOT);
}

export function useChangeVersions(sources: readonly string[]): number {
  const sourceKey = sources
    .map((source) => `${source.length}:${source}`)
    .join("\u0001");
  const stableSources = useMemo(() => {
    const uniqueSources: string[] = [];
    const seen = new Set<string>();
    for (const source of sources) {
      if (seen.has(source)) continue;
      seen.add(source);
      uniqueSources.push(source);
    }
    return uniqueSources;
  }, [sourceKey]);
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(stableSources, listener),
    [stableSources],
  );
  const getSnapshot = useCallback(
    () => stableSources.reduce((sum, src) => sum + store.get(src), 0),
    [stableSources],
  );

  return useSyncExternalStore(subscribe, getSnapshot, ZERO_SNAPSHOT);
}

export function _resetChangeVersionStoreForTests(): void {
  store.reset();
}
