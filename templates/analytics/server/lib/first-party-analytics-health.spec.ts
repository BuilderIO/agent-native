import { beforeEach, describe, expect, it, vi } from "vitest";

const insertConflictUpdate = vi.hoisted(() => vi.fn());
const insertValues = vi.hoisted(() => vi.fn());
const insert = vi.hoisted(() => vi.fn());
const getDb = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/index.js")>()),
  getDb,
}));
vi.mock("./credentials.js", () => ({
  hasCredential: vi.fn().mockResolvedValue(true),
}));

import {
  classifyFirstPartyAnalyticsQuery,
  FIRST_PARTY_ANALYTICS_PRESSURE_THRESHOLDS,
  queryOutcomeFromError,
  recordFirstPartyAnalyticsQueryPressure,
} from "./first-party-analytics-health";

beforeEach(() => {
  insertConflictUpdate.mockReset();
  insertValues.mockReset();
  insert.mockReset();
  getDb.mockReset();
  insert.mockReturnValue({ values: insertValues });
  insertValues.mockReturnValue({ onConflictDoUpdate: insertConflictUpdate });
  insertConflictUpdate.mockResolvedValue(undefined);
  getDb.mockReturnValue({ insert });
});

describe("first-party analytics pressure", () => {
  it("classifies raw, rollup, replay, and mixed queries without retaining SQL", () => {
    expect(
      classifyFirstPartyAnalyticsQuery(
        "SELECT count(*) FROM analytics_events WHERE event_date >= '2026-08-01'",
      ),
    ).toBe("raw-events");
    expect(
      classifyFirstPartyAnalyticsQuery(
        "SELECT event_date, SUM(event_count) FROM analytics_event_daily_rollups GROUP BY event_date",
      ),
    ).toBe("rollups");
    expect(
      classifyFirstPartyAnalyticsQuery(
        "SELECT id FROM session_recordings WHERE started_at >= '2026-08-01'",
      ),
    ).toBe("session-replay");
    expect(
      classifyFirstPartyAnalyticsQuery(
        "SELECT * FROM analytics_events JOIN analytics_user_days USING (event_date)",
      ),
    ).toBe("mixed");
  });

  it("distinguishes timeout failures from other query errors", () => {
    expect(queryOutcomeFromError(new Error("query timed out"))).toBe("timeout");
    expect(queryOutcomeFromError(new Error("permission denied"))).toBe("error");
  });

  it("writes an aggregate row for a slow query and keeps the query class only", async () => {
    await recordFirstPartyAnalyticsQueryPressure(
      { userEmail: "owner@example.com", orgId: "org_123" },
      {
        durationMs: FIRST_PARTY_ANALYTICS_PRESSURE_THRESHOLDS.slowQueryMs,
        outcome: "success",
        queryClass: "raw-events",
      },
    );

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "org:org_123",
        eventDate: expect.stringMatching(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        queryClass: "raw-events",
        slowQueryCount: 1,
        totalDurationMs: 5_000,
        maxDurationMs: 5_000,
      }),
    );
    expect(insertConflictUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.any(Array),
        set: expect.objectContaining({
          slowQueryCount: expect.anything(),
          maxDurationMs: expect.anything(),
        }),
      }),
    );
  });

  it("does not write fast successful queries", async () => {
    await recordFirstPartyAnalyticsQueryPressure(
      { userEmail: "owner@example.com", orgId: null },
      { durationMs: 100, outcome: "success", queryClass: "rollups" },
    );

    expect(insert).not.toHaveBeenCalled();
  });
});
