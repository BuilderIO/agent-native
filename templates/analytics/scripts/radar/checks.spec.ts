import { describe, expect, it } from "vitest";

import {
  classifyEventChange,
  evaluateThreshold,
  radarExitCode,
  type RadarCheckResult,
} from "./checks.ts";

function result(status: RadarCheckResult["status"]): RadarCheckResult {
  return {
    id: "sample",
    app: "design",
    window: "daily",
    baselineDays: 7,
    minN: 1,
    threshold: 0.5,
    operator: "lt",
    severity: "warning",
    message: "sample",
    query: "events",
    status,
  };
}

describe("radar check evaluation", () => {
  it("filters low-volume event changes and checks first-seen against the full prior month", () => {
    expect(
      classifyEventChange({
        currentCount: 2,
        previousSevenDayCount: 0,
        previousThirtyDayCount: 0,
        minN: 10,
      }),
    ).toBeNull();
    expect(
      classifyEventChange({
        currentCount: 0,
        previousSevenDayCount: 9,
        previousThirtyDayCount: 9,
        minN: 10,
      }),
    ).toBeNull();
    expect(
      classifyEventChange({
        currentCount: 12,
        previousSevenDayCount: 42,
        previousThirtyDayCount: 42,
        minN: 10,
      }),
    ).toBeNull();
    expect(
      classifyEventChange({
        currentCount: 12,
        previousSevenDayCount: 0,
        previousThirtyDayCount: 0,
        minN: 10,
      }),
    ).toBe("first_seen");
    expect(
      classifyEventChange({
        currentCount: 0,
        previousSevenDayCount: 10,
        previousThirtyDayCount: 40,
        minN: 10,
      }),
    ).toBe("went_to_zero");
  });

  it("does not fire with a sample below the configured minimum", () => {
    expect(
      evaluateThreshold({
        n: 2,
        minN: 10,
        value: 0,
        operator: "lt",
        threshold: 0.5,
      }),
    ).toBe("insufficient");
  });

  it("fires only after a threshold is crossed with enough data", () => {
    expect(
      evaluateThreshold({
        n: 10,
        minN: 10,
        value: 0.49,
        operator: "lt",
        threshold: 0.5,
      }),
    ).toBe("fired");
    expect(
      evaluateThreshold({
        n: 10,
        minN: 10,
        value: 0.5,
        operator: "lt",
        threshold: 0.5,
      }),
    ).toBe("clear");
  });

  it("fires on a point drop from baseline and reports missing baseline as unavailable", () => {
    expect(
      evaluateThreshold({
        n: 40,
        minN: 40,
        value: 0.3,
        baseline: 0.5,
        operator: "drop_points",
        threshold: 0.15,
      }),
    ).toBe("fired");
    expect(
      evaluateThreshold({
        n: 40,
        minN: 40,
        value: 0.3,
        baseline: null,
        operator: "drop_points",
        threshold: 0.15,
      }),
    ).toBe("unavailable");
  });

  it("uses 2 for unavailable evidence, 1 for fired checks, and 0 for quiet or small samples", () => {
    expect(radarExitCode([result("clear"), result("insufficient")])).toBe(0);
    expect(radarExitCode([result("fired"), result("clear")])).toBe(1);
    expect(radarExitCode([result("fired"), result("unavailable")])).toBe(2);
    expect(radarExitCode([result("observed")])).toBe(0);
  });
});
