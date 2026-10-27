import { describe, expect, it } from "vitest";

import {
  EVENT_WENT_TO_ZERO_MIN_N,
  RADAR_CHECKS,
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
  it("detects the historical environment-key incident at its observed sample size", () => {
    const definition = RADAR_CHECKS.find(
      (check) => check.id === "env-key-share",
    );
    expect(definition?.minN).toBe(5);
    expect(
      evaluateThreshold({
        n: 7,
        minN: definition?.minN ?? 0,
        value: 3 / 7,
        operator: "gt",
        threshold: 0.05,
      }),
    ).toBe("fired");
  });

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
        previousSevenDayCount: EVENT_WENT_TO_ZERO_MIN_N - 1,
        previousThirtyDayCount: 9,
        minN: 10,
        minWentToZeroN: EVENT_WENT_TO_ZERO_MIN_N,
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
        minWentToZeroN: 10,
      }),
    ).toBe("went_to_zero");
    expect(
      classifyEventChange({
        currentCount: 0,
        previousSevenDayCount: EVENT_WENT_TO_ZERO_MIN_N,
        previousThirtyDayCount: EVENT_WENT_TO_ZERO_MIN_N,
        minN: 10,
        minWentToZeroN: EVENT_WENT_TO_ZERO_MIN_N,
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

  it("uses 1 for fired or unavailable checks and 0 for quiet or small samples", () => {
    expect(radarExitCode([result("clear"), result("insufficient")])).toBe(0);
    expect(radarExitCode([result("fired"), result("clear")])).toBe(1);
    expect(radarExitCode([result("fired"), result("unavailable")])).toBe(1);
    expect(radarExitCode([result("unavailable")])).toBe(1);
    expect(radarExitCode([result("observed")])).toBe(0);
  });
});
