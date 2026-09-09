import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTtlCache } from "./ttl-cache.js";

describe("createTtlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a stored value until the TTL elapses, then forgets it", () => {
    const cache = createTtlCache<string>({ ttlMs: 1_000, maxEntries: 10 });
    cache.set("k", "v");

    expect(cache.get("k")).toBe("v");
    vi.advanceTimersByTime(999);
    expect(cache.get("k")).toBe("v");

    vi.advanceTimersByTime(1);
    expect(cache.get("k")).toBeUndefined();
    // Expiry also drops the entry rather than leaving it to accumulate.
    expect(cache.size).toBe(0);
  });

  it("distinguishes a stored falsy value from a miss", () => {
    // A consumer caching `false` (e.g. a classifier result) must not have it
    // read back as "not cached" and recomputed on every call.
    const cache = createTtlCache<boolean>({ ttlMs: 1_000, maxEntries: 10 });
    cache.set("no", false);
    expect(cache.get("no")).toBe(false);
    expect(cache.get("absent")).toBeUndefined();
  });

  it("evicts oldest-written first once maxEntries is exceeded", () => {
    const cache = createTtlCache<number>({ ttlMs: 60_000, maxEntries: 3 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.set("d", 4);

    expect(cache.size).toBe(3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("d")).toBe(4);
  });

  it("treats re-writing a key as the newest entry, not the oldest", () => {
    const cache = createTtlCache<number>({ ttlMs: 60_000, maxEntries: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 3); // refresh `a`
    cache.set("c", 4); // should evict `b`, not `a`

    expect(cache.get("a")).toBe(3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(4);
  });

  it("re-writing a key also refreshes its expiry", () => {
    const cache = createTtlCache<number>({ ttlMs: 1_000, maxEntries: 4 });
    cache.set("a", 1);
    vi.advanceTimersByTime(900);
    cache.set("a", 2);
    vi.advanceTimersByTime(900);
    expect(cache.get("a")).toBe(2);
  });

  it("supports single-key eviction and a full clear", () => {
    const cache = createTtlCache<number>({ ttlMs: 60_000, maxEntries: 10 });
    cache.set("a", 1);
    cache.set("b", 2);

    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("b")).toBeUndefined();
  });

  it("rejects a nonsensical configuration instead of silently never caching", () => {
    expect(() => createTtlCache({ ttlMs: 0, maxEntries: 1 })).toThrow(/ttlMs/);
    expect(() => createTtlCache({ ttlMs: -1, maxEntries: 1 })).toThrow(/ttlMs/);
    expect(() => createTtlCache({ ttlMs: 1, maxEntries: 0 })).toThrow(
      /maxEntries/,
    );
  });
});
