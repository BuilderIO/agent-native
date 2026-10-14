import { afterEach, describe, expect, it, vi } from "vitest";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

async function loadTracker(storage?: ReturnType<typeof memoryStorage>) {
  vi.resetModules();
  vi.stubGlobal("window", storage ? { localStorage: storage } : undefined);
  return import("./cost-tracker");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("cost tracker", () => {
  it("can be imported and updated without browser storage", async () => {
    const tracker = await loadTracker();

    expect(tracker.getTotalBytes()).toBe(0);
    expect(tracker.getTotalCost()).toBe(0);

    tracker.addBytesProcessed(1234);

    expect(tracker.getTotalBytes()).toBe(1234);
  });

  it("counts a scan once and nothing for a result that did not scan", async () => {
    const tracker = await loadTracker(memoryStorage());

    expect(
      tracker.recordQueryCost({ status: "success", bytesProcessed: 5_000 }),
    ).toEqual({ counted: 5_000, reason: "scanned" });
    for (const [record, reason] of [
      [{ cached: true, bytesProcessed: 9_000 }, "app-cache"],
      [{ providerCacheHit: true, bytesProcessed: 9_000 }, "provider-cache"],
      [{ restored: true, bytesProcessed: 9_000 }, "restored"],
      [{ bytesProcessed: 0 }, "no-bytes"],
      [{}, "no-bytes"],
      [{ bytesProcessed: -1 }, "invalid-bytes"],
      [{ bytesProcessed: Number.NaN }, "invalid-bytes"],
      [{ bytesProcessed: Infinity }, "invalid-bytes"],
      [{ bytesProcessed: "12" }, "invalid-bytes"],
    ] as const) {
      expect(tracker.recordQueryCost({ status: "success", ...record })).toEqual(
        { counted: 0, reason },
      );
    }

    expect(tracker.getTotalBytes()).toBe(5_000);
    expect(tracker.getUnknownScans()).toBe(0);
  });

  it("tallies failed and cancelled queries as unknown, not as zero cost", async () => {
    const tracker = await loadTracker(memoryStorage());

    for (const status of ["error", "cancelled"] as const) {
      expect(
        tracker.recordQueryCost({ status, bytesProcessed: 7_000 }),
      ).toEqual({ counted: 0, reason: "unknown-scan" });
    }

    expect(tracker.getTotalBytes()).toBe(0);
    expect(tracker.getUnknownScans()).toBe(2);
  });

  it("notifies subscribers only when the tally changes", async () => {
    const tracker = await loadTracker(memoryStorage());
    const listener = vi.fn();
    tracker.subscribe(listener);

    tracker.recordQueryCost({ status: "success", cached: true });
    tracker.recordQueryCost({ status: "success", bytesProcessed: 10 });
    tracker.recordQueryCost({ status: "error" });

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("drops the old 24h counter, whose totals included cache hits", async () => {
    const storage = memoryStorage({
      analytics_query_cost: JSON.stringify({
        bytes: 9_000_000_000,
        startedAt: Date.now(),
      }),
    });

    const tracker = await loadTracker(storage);

    expect(tracker.getTotalBytes()).toBe(0);
    expect(storage.data.has("analytics_query_cost")).toBe(false);
  });

  it("restores the versioned counter within 24h and drops it after", async () => {
    const now = Date.now();
    const key = "analytics_query_cost/v2";
    const recent = await loadTracker(
      memoryStorage({
        [key]: JSON.stringify({ bytes: 42, unknownScans: 1, startedAt: now }),
      }),
    );
    expect(recent.getTotalBytes()).toBe(42);
    expect(recent.getUnknownScans()).toBe(1);

    const storage = memoryStorage({
      [key]: JSON.stringify({
        bytes: 42,
        unknownScans: 1,
        startedAt: now - 25 * 60 * 60 * 1000,
      }),
    });
    const expired = await loadTracker(storage);
    expect(expired.getTotalBytes()).toBe(0);
    expect(storage.data.has(key)).toBe(false);
  });

  it("starts over from a stored counter it cannot trust, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const key = "analytics_query_cost/v2";
    const malformed = memoryStorage({
      [key]: JSON.stringify({ bytes: "lots", unknownScans: 0, startedAt: 1 }),
    });

    expect((await loadTracker(malformed)).getTotalBytes()).toBe(0);
    expect(malformed.data.has(key)).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[cost-tracker] discarded an invalid stored query cost",
      undefined,
    );

    const unreadable = memoryStorage({ [key]: "{not json" });
    expect((await loadTracker(unreadable)).getTotalBytes()).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not read"),
      "SyntaxError",
    );
  });

  it("keeps counting in memory when the counter cannot be stored", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    const tracker = await loadTracker(storage);

    tracker.recordQueryCost({ status: "success", bytesProcessed: 100 });

    expect(tracker.getTotalBytes()).toBe(100);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not store"),
      "QuotaExceededError",
    );
  });
});
