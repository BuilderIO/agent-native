import { describe, expect, it } from "vitest";

import { generationTimingFields } from "./generation-timing.js";

describe("generationTimingFields", () => {
  it("records a valid interval", () => {
    expect(generationTimingFields(100, 175)).toEqual({
      started_at_ms: 100,
      ended_at_ms: 175,
      duration_ms: 75,
    });
  });

  it("marks a cross-clock interval instead of reporting a false zero", () => {
    expect(generationTimingFields(175, 100)).toEqual({
      started_at_ms: 175,
      ended_at_ms: 100,
      duration_error: "clock_skew",
    });
  });

  it("keeps the end timestamp when no start time is available", () => {
    expect(generationTimingFields(undefined, 100)).toEqual({
      ended_at_ms: 100,
    });
  });
});
