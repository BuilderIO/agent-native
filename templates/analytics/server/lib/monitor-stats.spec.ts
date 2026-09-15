import { describe, expect, it } from "vitest";

import {
  assembleDailyTimeline,
  averageResponse,
  bucketStatusFromCounts,
  computeMtbf,
  computeUptimePercents,
  type DailyBucketRow,
  type ResponseTimePoint,
} from "./monitor-stats";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("computeUptimePercents", () => {
  it("computes percentages per window and null for empty windows", () => {
    const windows = computeUptimePercents({
      total24h: 100,
      ok24h: 99,
      total7d: 0,
      ok7d: 0,
      total30d: 200,
      ok30d: 200,
      total90d: 1000,
      ok90d: 950,
    });
    expect(windows.uptime24h).toBeCloseTo(99, 5);
    expect(windows.uptime7d).toBeNull();
    expect(windows.uptime30d).toBe(100);
    expect(windows.uptime90d).toBeCloseTo(95, 5);
  });
});

describe("bucketStatusFromCounts", () => {
  it("is no-data when there were no checks", () => {
    expect(bucketStatusFromCounts(0, 0, 0)).toBe("no-data");
  });
  it("prioritizes down over degraded", () => {
    expect(bucketStatusFromCounts(10, 1, 5)).toBe("down");
  });
  it("is degraded when only degraded checks exist", () => {
    expect(bucketStatusFromCounts(10, 0, 2)).toBe("degraded");
  });
  it("is up when all checks are healthy", () => {
    expect(bucketStatusFromCounts(10, 0, 0)).toBe("up");
  });
});

describe("assembleDailyTimeline", () => {
  const now = new Date("2026-03-10T12:00:00.000Z");

  it("produces a dense, gap-filled trailing window oldest → newest", () => {
    const rows: DailyBucketRow[] = [
      { day: "2026-03-08", total: 10, ok: 10, down: 0, degraded: 0 },
      { day: "2026-03-10", total: 10, ok: 8, down: 2, degraded: 0 },
    ];
    const buckets = assembleDailyTimeline(rows, { now, days: 3 });
    expect(buckets).toHaveLength(3);
    // Oldest bucket first (2026-03-08), newest last (2026-03-10).
    expect(buckets[0].start).toBe("2026-03-08T00:00:00.000Z");
    expect(buckets[0].status).toBe("up");
    // The middle day (03-09) had no checks → no-data gap fill.
    expect(buckets[1].status).toBe("no-data");
    expect(buckets[1].uptimePct).toBeNull();
    expect(buckets[1].total).toBe(0);
    // Newest day had a failure.
    expect(buckets[2].status).toBe("down");
    expect(buckets[2].uptimePct).toBeCloseTo(80, 5);
    expect(buckets[2].downCount).toBe(2);
  });

  it("caps the most recent bucket's end at now", () => {
    const buckets = assembleDailyTimeline([], { now, days: 1 });
    expect(buckets).toHaveLength(1);
    expect(buckets[0].end).toBe(now.toISOString());
    expect(buckets[0].status).toBe("no-data");
  });
});

describe("computeMtbf", () => {
  const nowMs = Date.parse("2026-03-10T00:00:00.000Z");
  const windowStartMs = nowMs - 30 * DAY_MS;

  it("returns null when there are no failures", () => {
    expect(computeMtbf([], { windowStartMs, nowMs })).toBeNull();
  });

  it("divides operational time by the failure count", () => {
    // Two 1-hour incidents in a 30-day window.
    const HOUR = 60 * 60 * 1000;
    const incidents = [
      {
        startedAt: new Date(nowMs - 10 * DAY_MS).toISOString(),
        resolvedAt: new Date(nowMs - 10 * DAY_MS + HOUR).toISOString(),
      },
      {
        startedAt: new Date(nowMs - 5 * DAY_MS).toISOString(),
        resolvedAt: new Date(nowMs - 5 * DAY_MS + HOUR).toISOString(),
      },
    ];
    const mtbf = computeMtbf(incidents, { windowStartMs, nowMs });
    const windowMs = nowMs - windowStartMs;
    const expected = (windowMs - 2 * HOUR) / 2;
    expect(mtbf).toBeCloseTo(expected, -3);
  });

  it("treats an unresolved incident as ongoing until now and clamps to the window", () => {
    const incidents = [
      {
        startedAt: new Date(windowStartMs - 5 * DAY_MS).toISOString(), // starts before window
        resolvedAt: null, // ongoing
      },
    ];
    const mtbf = computeMtbf(incidents, { windowStartMs, nowMs });
    // Entire window is downtime (clamped), so operational time is 0.
    expect(mtbf).toBe(0);
  });
});

describe("averageResponse", () => {
  it("computes a count-weighted average, ignoring null buckets", () => {
    const series: ResponseTimePoint[] = [
      { bucketStart: "a", avg: 100, min: 90, max: 110, count: 1 },
      { bucketStart: "b", avg: 200, min: 190, max: 210, count: 3 },
      { bucketStart: "c", avg: null, min: null, max: null, count: 0 },
    ];
    // (100*1 + 200*3) / 4 = 175
    expect(averageResponse(series)).toBeCloseTo(175, 5);
  });

  it("returns null when there is no data", () => {
    expect(averageResponse([])).toBeNull();
  });
});
