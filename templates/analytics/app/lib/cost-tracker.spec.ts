import { describe, expect, it, vi } from "vitest";

describe("cost tracker", () => {
  it("can be imported and updated without browser storage", async () => {
    vi.resetModules();
    vi.stubGlobal("window", undefined);

    try {
      const tracker = await import("./cost-tracker");

      expect(tracker.getTotalBytes()).toBe(0);
      expect(tracker.getTotalCost()).toBe(0);

      tracker.addBytesProcessed(1234);

      expect(tracker.getTotalBytes()).toBe(1234);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
