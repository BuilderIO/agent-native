import { describe, expect, it } from "vitest";

import type { RadarCheckResult } from "./checks.ts";
import { RadarQueryError } from "./query.ts";
import {
  acquisitionContextForWeek,
  captureWeeklyPrefetchResult,
  completedReportWeekEnd,
  DEFAULT_WEEKLY_MAX_TOTAL_GB,
  formatWeeklyMarkdown,
  parseReportArgs,
  recoveryStateForIssue,
} from "./report.ts";
import type { RadarWeeklyReport } from "./report.ts";

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

describe("weekly prefetch failure", () => {
  it("keeps the failed prefetch distinct so daily reads can be retried", async () => {
    await expect(
      captureWeeklyPrefetchResult(async () => {
        throw new RadarQueryError("BigQuery request failed (HTTP 500).", 1);
      }),
    ).resolves.toEqual({
      value: undefined,
      failed: true,
      completedQueries: 0,
      error: "BigQuery request failed (HTTP 500).",
    });
  });

  it("counts completed cached reads independently from physical query jobs", async () => {
    await expect(
      captureWeeklyPrefetchResult(async (queryCompleted) => {
        queryCompleted();
        return { cacheHit: true };
      }),
    ).resolves.toEqual({
      value: { cacheHit: true },
      failed: false,
      completedQueries: 1,
      error: null,
    });
  });

  it("retains successful prefetch reads and the safe cause after a later failure", async () => {
    await expect(
      captureWeeklyPrefetchResult(async (queryCompleted) => {
        queryCompleted();
        throw new RadarQueryError("BigQuery request failed (HTTP 503).", 1);
      }),
    ).resolves.toEqual({
      value: undefined,
      failed: true,
      completedQueries: 1,
      error: "BigQuery request failed (HTTP 503).",
    });
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
      freshBigQuery: false,
    });
  });

  it("runs journey snapshots by default", () => {
    expect(parseReportArgs(["--week", "2026-10-19"])).toEqual({
      week: "2026-10-19",
      skipJourneySnapshot: false,
      maxTotalGb: DEFAULT_WEEKLY_MAX_TOTAL_GB,
      freshBigQuery: false,
    });
  });

  it("accepts an explicit positive report-wide BigQuery scan cap", () => {
    expect(
      parseReportArgs(["--week", "2026-10-19", "--max-total-gb", "25"]),
    ).toEqual({
      week: "2026-10-19",
      skipJourneySnapshot: false,
      maxTotalGb: 25,
      freshBigQuery: false,
    });
  });

  it("can bypass the BigQuery cache for a complete scan measurement", () => {
    expect(
      parseReportArgs(["--week", "2026-10-19", "--fresh-bigquery"]),
    ).toEqual({
      week: "2026-10-19",
      skipJourneySnapshot: false,
      maxTotalGb: DEFAULT_WEEKLY_MAX_TOTAL_GB,
      freshBigQuery: true,
    });
  });
});

describe("weekly funnel cohort reporting", () => {
  it("shows each daily run's mature signup cohort date", () => {
    const report = {
      generatedAt: "2026-10-27T23:59:00.000Z",
      week: "2026-10-26",
      weekEnd: "2026-11-01",
      coverage: {
        dailyRuns: { expected: 7, completed: 1, failedDates: [] },
        campaignFollowup: true,
        abReadout: false,
        replayTriage: false,
        journeySnapshot: "skipped",
        weeklyPrefetch: {
          status: "failed_fallback",
          completedQueries: 2,
          error: null,
        },
        feedbackIngest: "agent_required",
        queryCount: 0,
        bigQueryScan: {
          maxGb: 100,
          reservedBytes: 12_340_000_000,
          actualBytesProcessed: 9_876_000_000,
          actualQueryCount: 7,
          unaccountedQueryCount: 0,
          exceeded: false,
        },
      },
      dailyRuns: [
        {
          date: "2026-10-26",
          run: {
            generatedAt: "2026-10-27T23:59:00.000Z",
            window: "daily",
            date: "2026-10-26",
            exitCode: 1,
            checks: [],
            journeyRows: [],
            campaignAnnotations: [],
            issues: [],
            coverage: {
              eventSourceCoverage: {},
              funnelCohortDate: "2026-10-25",
            },
            queryCount: 0,
          },
        },
      ],
      triageSummary: null,
      triageError: "not run",
      abReadout: null,
      campaignFollowup: {
        campaign: "outage_recovery_20261026",
        sentRecipients: 1,
        skippedRows: 0,
        byRecipientApp: { clips: 1 },
        rows: [
          {
            period: "after_send",
            recipient_app: "clips",
            activity_app: "clips",
            metric: "any_visit",
            recipients: 1,
            recipients_with_activity: 1,
          },
        ],
        observedAt: "2026-10-27T00:00:00.000Z",
      },
      campaignAnnotations: [],
      acquisitionContext: [],
      firedIssues: [],
      recovery: { available: false, items: [] },
      journeySnapshot: { status: "skipped" },
      feedback: { status: "agent_required", skill: "feedback-ingest" },
      exitCode: 2,
    } satisfies RadarWeeklyReport;

    const formatted = formatWeeklyMarkdown(report);
    expect(formatted).toContain("| 2026-10-26 | 2026-10-25 | 1 | 0 | 0 | - |");
    expect(formatted).toContain(
      "BigQuery uses keyed HMAC-SHA256 matching; the PostgreSQL path uses bound recipient email values.",
    );
    expect(formatted).toContain(
      "BigQuery actual bytes processed: 9.88 GB across 7 executed queries.",
    );
    expect(formatted).toContain("Dry-run estimate: 12.34 GB / 100 GB.");
    expect(formatted).toContain(
      "Weekly prefetch failed; 2/4 queries completed before daily fallback.",
    );

    expect(
      formatWeeklyMarkdown({
        ...report,
        coverage: {
          ...report.coverage,
          weeklyPrefetch: {
            status: "complete",
            completedQueries: 4,
            error: null,
          },
        },
      }),
    ).toContain("Weekly prefetch: complete; 4/4 queries completed.");
    expect(
      formatWeeklyMarkdown({
        ...report,
        coverage: {
          ...report.coverage,
          weeklyPrefetch: {
            status: "not_applicable",
            completedQueries: 0,
            error: null,
          },
        },
      }),
    ).toContain(
      "Weekly prefetch: not applicable; no BigQuery prefetch was needed.",
    );

    const partialAccounting = formatWeeklyMarkdown({
      ...report,
      coverage: {
        ...report.coverage,
        weeklyPrefetch: {
          ...report.coverage.weeklyPrefetch,
          error: "BigQuery request failed (HTTP 503).",
        },
        bigQueryScan: {
          ...report.coverage.bigQueryScan,
          unaccountedQueryCount: 1,
        },
      },
    });
    expect(partialAccounting).toContain(
      "Cause: BigQuery request failed (HTTP 503).",
    );
    expect(partialAccounting).toContain(
      "BigQuery actual bytes observed: 9.88 GB across 7 jobs with reported bytes; 1 submitted job(s) could not be fully accounted.",
    );
    expect(partialAccounting).not.toContain("BigQuery actual bytes processed:");
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
