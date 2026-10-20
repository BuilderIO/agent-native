// @vitest-environment happy-dom

import type { EmailMessage } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const THREAD_CACHE_STORAGE_KEY = "mail.threadCache.v1";
const THREAD_CACHE_GLOBALS = [
  "__mailThreadCacheFormat",
  "__mailThreadOwner",
  "__mailThreadCache",
  "__mailThreadInflight",
  "__mailThreadSubscribers",
  "__mailThreadVersions",
  "__mailThreadCacheGeneration",
] as const;

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

describe("thread cache privacy", () => {
  let storage: Storage;
  let localStorageDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.resetModules();
    storage = createStorage();
    localStorageDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "localStorage",
    );
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storage,
    });
    for (const key of THREAD_CACHE_GLOBALS) {
      delete (globalThis as unknown as Record<string, unknown>)[key];
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    for (const key of THREAD_CACHE_GLOBALS) {
      delete (globalThis as unknown as Record<string, unknown>)[key];
    }
    for (const key of ["__threadCache", "__showSkeleton", "__hideSkeleton"]) {
      delete (window as unknown as Record<string, unknown>)[key];
    }
    if (localStorageDescriptor) {
      Object.defineProperty(window, "localStorage", localStorageDescriptor);
    } else {
      delete (window as unknown as { localStorage?: Storage }).localStorage;
    }
  });

  it("clears legacy persisted thread bodies and keeps new entries in memory", async () => {
    storage.setItem(
      THREAD_CACHE_STORAGE_KEY,
      JSON.stringify({
        "private-thread": {
          messages: [{ id: "private-message", body: "private body" }],
          fetchedAt: Date.now(),
        },
      }),
    );

    const threadCache = await import("./thread-cache");

    expect(storage.getItem(THREAD_CACHE_STORAGE_KEY)).toBeNull();
    expect(threadCache.getCachedThread("private-thread")).toBeUndefined();

    vi.useFakeTimers();
    threadCache.setCachedThread("new-thread", []);
    await vi.advanceTimersByTimeAsync(300);

    expect(storage.getItem(THREAD_CACHE_STORAGE_KEY)).toBeNull();
    expect(threadCache.getCachedThread("new-thread")).toEqual([]);
  });

  it("scopes cached threads to the signed-in user and mailbox", async () => {
    const threadCache = await import("./thread-cache");
    const accountA = [
      { id: "message-a", accountEmail: "first@example.test" } as EmailMessage,
    ];
    const accountB = [
      { id: "message-b", accountEmail: "second@example.test" } as EmailMessage,
    ];

    threadCache.setThreadCacheOwner("user-a");
    threadCache.setCachedThread("shared-thread", accountA);
    threadCache.setCachedThread("shared-thread", accountB);

    expect(threadCache.getCachedThread("shared-thread")).toBeUndefined();
    expect(
      threadCache.getCachedThread("shared-thread", "first@example.test"),
    ).toEqual(accountA);
    expect(
      threadCache.getCachedThread("shared-thread", "second@example.test"),
    ).toEqual(accountB);

    threadCache.setThreadCacheOwner("user-b");

    expect(
      threadCache.getCachedThread("shared-thread", "first@example.test"),
    ).toBeUndefined();
    expect(
      threadCache.getCachedThread("shared-thread", "second@example.test"),
    ).toBeUndefined();
  });

  it("clears private bodies and fences fetches when the session or account changes", async () => {
    const threadCache = await import("./thread-cache");
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    threadCache.setThreadCacheSessionScope("session-a");
    threadCache.setThreadCacheAccountScope("account-a");
    threadCache.setCachedThread("private-thread", [
      { id: "private-message", body: "private body" } as never,
    ]);
    const oldAccountFetch = threadCache.ensureThread(
      "shared-thread",
      "account-a@example.test",
    );

    threadCache.setThreadCacheSessionScope("session-b");
    expect(threadCache.getCachedThread("private-thread")).toBeUndefined();
    expect(threadCache.getCachedThread("shared-thread")).toBeUndefined();

    resolveFetch({
      ok: true,
      json: async () => [{ id: "old-message", body: "old account body" }],
    } as Response);
    await oldAccountFetch;
    expect(threadCache.getCachedThread("shared-thread")).toBeUndefined();

    threadCache.setCachedThread("shared-thread", [
      { id: "new-message", body: "new account body" } as never,
    ]);
    threadCache.setThreadCacheAccountScope("account-b");
    expect(threadCache.getCachedThread("shared-thread")).toBeUndefined();
  });
});

describe("thread prefetch during a cooldown", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const key of THREAD_CACHE_GLOBALS) {
      delete (globalThis as unknown as Record<string, unknown>)[key];
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("holds back speculative warms during a rate-limit cooldown but still opens a thread", async () => {
    const threadCache = await import("./thread-cache");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers(),
        json: async () => ({ error: "Rate limited" }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => [{ id: "opened-message", body: "body" }],
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      threadCache.ensureThread("rate-limited-thread", "a@example.test"),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    threadCache.warmThreads([
      { id: "hovered-thread", accountEmail: "a@example.test" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await threadCache.ensureThread("opened-thread", "a@example.test");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
