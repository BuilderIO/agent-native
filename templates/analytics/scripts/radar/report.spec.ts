import { describe, expect, it } from "vitest";

import type { RadarCheckResult } from "./checks.ts";
import {
  acquisitionContextForWeek,
  completedReportWeekEnd,
  DEFAULT_WEEKLY_MAX_TOTAL_GB,
  parseReportArgs,
  recoveryStateForIssue,
} from "./report.ts";

const check = (status: RadarCheckResult["status"]): RadarCheckResult => ({
  id: "setup-exposure",
  app: "clips",
  window: "daily",
  baselineDays: 7,
  minN: 1,
  threshold: null,
  operator: "signal",
  severity: "warning",
  message: "setup exposure check",
  query: "events",
  status,
});

describe("weekly recovery evidence", () => {
  it("does not call a missing or omitted final-day check recovered", () => {
    expect(recoveryStateForIssue(undefined, "setup-exposure|clips")).toBe(
      "unknown",
    );
    expect(recoveryStateForIssue([], "setup-exposure|clips")).toBe("unknown");
    expect(
      recoveryStateForIssue([check("insufficient")], "setup-exposure|clips"),
    ).toBe("unknown");
    expect(
      recoveryStateForIssue([check("unavailable")], "setup-exposure|clips"),
    ).toBe("unknown");
  });

  it("reports recovery only from a present completed check", () => {
    expect(
      recoveryStateForIssue([check("fired")], "setup-exposure|clips"),
    ).toBe("still_broken");
    expect(
      recoveryStateForIssue([check("clear")], "setup-exposure|clips"),
    ).toBe("recovered");
    expect(
      recoveryStateForIssue([check("observed")], "setup-exposure|clips"),
    ).toBe("recovered");
  });
});

describe("weekly paid-acquisition context", () => {
  it("includes changes during the report week and preceding baseline week", () => {
    expect(acquisitionContextForWeek("2026-10-19", "2026-10-25")).toEqual([
      expect.objectContaining({ effectiveAt: "2026-10-16", app: "slides" }),
      expect.objectContaining({ effectiveAt: "2026-10-20 21:00 UTC" }),
      expect.objectContaining({ effectiveAt: "2026-10-21" }),
    ]);
    expect(acquisitionContextForWeek("2026-11-02", "2026-11-08")).toEqual([]);
  });
});

describe("weekly report arguments", () => {
  it.each([["--week"], ["--week", "--skip-journey-snapshot"]])(
    "rejects a missing --week value",
    (...args) => {
      expect(() => parseReportArgs(args)).toThrow("--week requires a value.");
    },
  );

  it("rejects a missing --max-total-gb value", () => {
    expect(() => parseReportArgs(["--max-total-gb"])).toThrow(
      "--max-total-gb requires a value.",
    );
  });

  it("can skip screenshot snapshot generation while keeping the week", () => {
    expect(
      parseReportArgs(["--week", "2026-10-19", "--skip-journey-snapshot"]),
    ).toEqual({
      week: "2026-10-19",
      skipJourneySnapshot: true,
      maxTotalGb: DEFAULT_WEEKLY_MAX_TOTAL_GB,
    });
  });

  it("runs journey snapshots by default", () => {
    expect(parseReportArgs(["--week", "2026-10-19"])).toEqual({
      week: "2026-10-19",
      skipJourneySnapshot: false,
      maxTotalGb: DEFAULT_WEEKLY_MAX_TOTAL_GB,
    });
  });

  it("accepts an explicit positive report-wide BigQuery scan cap", () => {
    expect(
      parseReportArgs(["--week", "2026-10-19", "--max-total-gb", "25"]),
    ).toEqual({
      week: "2026-10-19",
      skipJourneySnapshot: false,
      maxTotalGb: 25,
    });
  });
});

describe("completed report week boundary", () => {
  it("accepts a completed week and rejects current or future weeks", () => {
    expect(completedReportWeekEnd("2026-10-19", "2026-10-26")).toBe(
      "2026-10-25",
    );
    expect(() => completedReportWeekEnd("2026-10-26", "2026-10-26")).toThrow(
      /partial and future weeks are unavailable/,
    );
    expect(() => completedReportWeekEnd("2026-11-02", "2026-10-26")).toThrow(
      /partial and future weeks are unavailable/,
    );
  });

  it("rejects impossible dates that normalize to a Monday", () => {
    expect(() => completedReportWeekEnd("2026-02-30", "2026-10-26")).toThrow(
      /must be a Monday/,
    );
  });
});
