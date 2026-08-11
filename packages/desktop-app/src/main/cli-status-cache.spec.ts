import { describe, expect, it } from "vitest";

import { cachedCliStatus, createCliStatusCache } from "./cli-status-cache.js";

describe("cachedCliStatus", () => {
  it("probes synchronously only on the first call, then serves the cache", () => {
    const cache = createCliStatusCache<string>();
    let syncProbes = 0;
    const probeSync = () => {
      syncProbes += 1;
      return "codex";
    };
    const probeAsync = () => Promise.resolve("codex");
    let clock = 0;

    const first = cachedCliStatus(
      cache,
      probeSync,
      probeAsync,
      () => clock,
      1000,
    );
    expect(first).toBe("codex");
    expect(syncProbes).toBe(1);

    // The 5s host-metadata poll must not spawn a process again inside the TTL.
    for (let i = 0; i < 20; i += 1) {
      clock += 10;
      expect(
        cachedCliStatus(cache, probeSync, probeAsync, () => clock, 1000),
      ).toBe("codex");
    }
    expect(syncProbes).toBe(1);
  });

  it("refreshes off the event loop once stale, without blocking the caller", async () => {
    const cache = createCliStatusCache<string>();
    let clock = 0;
    let asyncProbes = 0;
    const probeSync = () => "stale";
    const probeAsync = async () => {
      asyncProbes += 1;
      return "fresh";
    };

    cachedCliStatus(cache, probeSync, probeAsync, () => clock, 1000);
    clock = 5000;

    // The stale read still returns immediately with the last known value.
    expect(
      cachedCliStatus(cache, probeSync, probeAsync, () => clock, 1000),
    ).toBe("stale");
    await new Promise((resolve) => setImmediate(resolve));
    expect(asyncProbes).toBe(1);
    expect(
      cachedCliStatus(cache, probeSync, probeAsync, () => clock, 1000),
    ).toBe("fresh");
  });

  it("does not stack concurrent refreshes while one is in flight", async () => {
    const cache = createCliStatusCache<string>();
    let clock = 0;
    let asyncProbes = 0;
    const gate: { release?: () => void } = {};
    const probeAsync = async () => {
      asyncProbes += 1;
      await new Promise<void>((resolve) => {
        gate.release = resolve;
      });
      return "fresh";
    };

    cachedCliStatus(
      cache,
      () => "stale",
      probeAsync,
      () => clock,
      1000,
    );
    clock = 5000;
    for (let i = 0; i < 5; i += 1) {
      cachedCliStatus(
        cache,
        () => "stale",
        probeAsync,
        () => clock,
        1000,
      );
    }
    expect(asyncProbes).toBe(1);

    gate.release?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(
      cachedCliStatus(
        cache,
        () => "stale",
        probeAsync,
        () => clock,
        1000,
      ),
    ).toBe("fresh");
  });
});
