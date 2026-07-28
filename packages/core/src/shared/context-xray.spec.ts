import { describe, expect, it } from "vitest";

import { resolveManifestFreshness } from "./context-xray.js";

describe("resolveManifestFreshness", () => {
  it("is current when the manifest names the newest turn", () => {
    expect(
      resolveManifestFreshness({
        manifest: { turnId: "turn-2", updatedAt: 200 },
        latestTurnId: "turn-2",
        latestTurnStartedAt: 150,
      }),
    ).toBe("current");
  });

  it("is stale when the manifest trails the newest turn", () => {
    expect(
      resolveManifestFreshness({
        manifest: { turnId: "turn-1", updatedAt: 100 },
        latestTurnId: "turn-2",
        latestTurnStartedAt: 150,
      }),
    ).toBe("stale");
  });

  it("is unavailable when the newest write failed", () => {
    expect(
      resolveManifestFreshness({
        manifest: { turnId: "turn-2", updatedAt: 200, writeStatus: "failed" },
        latestTurnId: "turn-2",
        latestTurnStartedAt: 150,
      }),
    ).toBe("unavailable");
  });

  it("is current when no run has been recorded for the thread", () => {
    expect(resolveManifestFreshness({ manifest: { turnId: "turn-1" } })).toBe(
      "current",
    );
  });

  it("falls back to timestamps for manifests written before turnId existed", () => {
    expect(
      resolveManifestFreshness({
        manifest: { updatedAt: 100 },
        latestTurnId: "turn-2",
        latestTurnStartedAt: 150,
      }),
    ).toBe("stale");
    expect(
      resolveManifestFreshness({
        manifest: { updatedAt: 200 },
        latestTurnId: "turn-2",
        latestTurnStartedAt: 150,
      }),
    ).toBe("current");
  });

  it("is unavailable, never current, when freshness cannot be established", () => {
    expect(
      resolveManifestFreshness({ manifest: {}, latestTurnId: "turn-2" }),
    ).toBe("unavailable");
    expect(resolveManifestFreshness({ manifest: null })).toBe("unavailable");
  });
});
