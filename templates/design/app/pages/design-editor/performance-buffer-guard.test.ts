import { describe, expect, it, vi } from "vitest";

import {
  shouldClearPerformanceBuffer,
  sweepPerformanceBufferIfNeeded,
} from "./performance-buffer-guard";

describe("performance buffer guard", () => {
  it("clears marks and measures only after their combined count exceeds the limit", () => {
    expect(shouldClearPerformanceBuffer(1_500, 1_500, 3_000)).toBe(false);
    expect(shouldClearPerformanceBuffer(1_501, 1_500, 3_000)).toBe(true);
  });

  it("sweeps both buffers when the limit is exceeded", () => {
    const clearMarks = vi.fn();
    const clearMeasures = vi.fn();
    const didClear = sweepPerformanceBufferIfNeeded(
      {
        getEntriesByType: (type) => ({
          length: type === "mark" ? 2_000 : 1_001,
        }),
        clearMarks,
        clearMeasures,
      },
      3_000,
    );

    expect(didClear).toBe(true);
    expect(clearMarks).toHaveBeenCalledOnce();
    expect(clearMeasures).toHaveBeenCalledOnce();
  });

  it("does nothing when the timing clear APIs are unavailable", () => {
    expect(
      sweepPerformanceBufferIfNeeded({
        getEntriesByType: () => ({ length: 10_000 }),
      }),
    ).toBe(false);
  });
});
