import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetWorkspaceAppAccessCacheForTests,
  cachedWorkspaceAppAccess,
  createInMemoryWorkspaceAppAccessDecisionStore,
  invalidateWorkspaceAppAccessCache,
  setWorkspaceAppAccessDecisionStore,
  type WorkspaceAppAccessDecisionStore,
} from "./workspace-app-access-cache.js";

const key = { appId: "gtm", email: "member@example.com", orgId: "org-1" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("cachedWorkspaceAppAccess", () => {
  afterEach(() => {
    __resetWorkspaceAppAccessCacheForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("caches an allow until the TTL lapses", async () => {
    vi.useFakeTimers();
    setWorkspaceAppAccessDecisionStore(
      createInMemoryWorkspaceAppAccessDecisionStore({ ttlMs: 1_000 }),
    );
    const load = vi.fn().mockResolvedValue(true);

    await cachedWorkspaceAppAccess(key, load);
    await cachedWorkspaceAppAccess(key, load);
    expect(load).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_001);
    await cachedWorkspaceAppAccess(key, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never caches a deny", async () => {
    const load = vi.fn().mockResolvedValue(false);

    await expect(cachedWorkspaceAppAccess(key, load)).resolves.toBe(false);
    await expect(cachedWorkspaceAppAccess(key, load)).resolves.toBe(false);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one load between concurrent callers", async () => {
    const pending = deferred<boolean>();
    const load = vi.fn().mockReturnValue(pending.promise);

    const first = cachedWorkspaceAppAccess(key, load);
    const second = cachedWorkspaceAppAccess(key, load);
    pending.resolve(true);

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not store an allow that was loaded before an invalidation", async () => {
    const pending = deferred<boolean>();
    const load = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(true);

    const stale = cachedWorkspaceAppAccess(key, load);
    await invalidateWorkspaceAppAccessCache();
    pending.resolve(true);
    await stale;

    await cachedWorkspaceAppAccess(key, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("uses an installed store implementation", async () => {
    const entries = new Map<string, boolean>();
    const store: WorkspaceAppAccessDecisionStore = {
      get: vi.fn(async (k: string) => entries.get(k)),
      set: vi.fn(async (k: string, allowed: boolean) => {
        entries.set(k, allowed);
      }),
      clear: vi.fn(async () => entries.clear()),
    };
    setWorkspaceAppAccessDecisionStore(store);
    const load = vi.fn().mockResolvedValue(true);

    await cachedWorkspaceAppAccess(key, load);
    await cachedWorkspaceAppAccess(key, load);
    await invalidateWorkspaceAppAccessCache();

    expect(load).toHaveBeenCalledTimes(1);
    expect(store.set).toHaveBeenCalledTimes(1);
    expect(store.clear).toHaveBeenCalledTimes(1);
  });

  it("falls back to the loader when the store fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setWorkspaceAppAccessDecisionStore({
      get: () => Promise.reject(new Error("cache down")),
      set: () => Promise.reject(new Error("cache down")),
      clear: () => Promise.reject(new Error("cache down")),
    });
    const load = vi.fn().mockResolvedValue(true);

    await expect(cachedWorkspaceAppAccess(key, load)).resolves.toBe(true);
    await expect(invalidateWorkspaceAppAccessCache()).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
