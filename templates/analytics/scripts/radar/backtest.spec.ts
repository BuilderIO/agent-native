import { describe, expect, it } from "vitest";

import {
  backtestHourOf,
  formatRadarBacktest,
  noReplayRejectionObservation,
  parseRadarBacktestArgs,
} from "./backtest.ts";

describe("backtestHourOf", () => {
  it("formats BigQuery Date values in UTC hour buckets", () => {
    expect(backtestHourOf(new Date("2026-10-09T05:47:00.000Z"))).toBe(
      "2026-10-09T05",
    );
  });

  it("normalizes timestamp strings to their hour bucket", () => {
    expect(backtestHourOf("2026-10-09 05:47:00+00")).toBe("2026-10-09T05");
  });

  it("accepts a lower cumulative scan budget", () => {
    expect(parseRadarBacktestArgs(["--max-total-gb", "25"])).toEqual({
      maxTotalGb: 25,
    });
    expect(() => parseRadarBacktestArgs(["--max-total-gb"])).toThrow(
      "--max-total-gb must be positive.",
    );
  });

  it("shows insufficient evidence instead of zero fires on an empty source", () => {
    const report = formatRadarBacktest({
      clean: { start: "2026-10-02", end: "2026-10-08" },
      incident: { start: "2026-10-09", end: "2026-10-23" },
      observations: [
        {
          check: "builder-connect-success",
          app: "clips",
          period: "clean:2026-10-02T00",
          status: "insufficient",
          numerator: null,
          denominator: null,
          value: null,
          detail: "No source rows.",
        },
      ],
      scanEstimateGb: 1,
      maxTotalGb: 100,
    });

    expect(report).toContain(
      "| builder-connect-success | clean | clips | 0 | 0 | 0 | 1 |",
    );
    expect(report).toContain("BigQuery dry-run estimate: 1.00 GB / 100 GB.");
  });
});

describe("noReplayRejectionObservation", () => {
  it("keeps periods without rejection rows insufficient without recorder coverage", () => {
    expect(
      noReplayRejectionObservation("2026-10-12", "slides", "incident"),
    ).toMatchObject({
      check: "replay-upload-rejection",
      app: "slides",
      period: "incident:2026-10-12",
      status: "insufficient",
      denominator: null,
    });
  });
});
