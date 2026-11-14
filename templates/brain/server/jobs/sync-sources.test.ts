import { describe, expect, it } from "vitest";

import {
  type SourceScanPage,
  collectDueSources,
  isBrainSourceDue,
  nextBrainSourceSyncAt,
} from "./sync-sources.js";

const FAILED_AT = "2026-07-29T16:00:00.000Z";
const POLL_INTERVAL_MS = 60 * 60 * 1000;

function source(
  overrides: Record<string, unknown> = {},
): Parameters<typeof isBrainSourceDue>[0] {
  return {
    id: "source-1",
    title: "Brain source",
    provider: "granola",
    status: "active",
    sourceKey: null,
    ingestTokenHash: null,
    configJson: JSON.stringify({ autoSync: true, pollMinutes: 60 }),
    cursorJson: "{}",
    lastSyncedAt: null,
    lastError: null,
    ownerEmail: "owner@example.test",
    orgId: "org-1",
    visibility: "org",
    createdAt: FAILED_AT,
    updatedAt: FAILED_AT,
    ...overrides,
  } as Parameters<typeof isBrainSourceDue>[0];
}

describe("Brain source sync scheduling", () => {
  it("does not immediately retry an errored auto-sync source", () => {
    const failedSource = source({
      status: "error",
      lastError: "Temporary provider failure",
    });
    const failedAt = Date.parse(FAILED_AT);

    expect(isBrainSourceDue(failedSource, failedAt)).toBe(false);
    expect(
      isBrainSourceDue(failedSource, failedAt + POLL_INTERVAL_MS - 1),
    ).toBe(false);
    expect(nextBrainSourceSyncAt(failedSource)).toBe(
      "2026-07-29T17:00:00.000Z",
    );
  });

  it("makes an errored auto-sync source due after its poll interval", () => {
    const failedSource = source({
      status: "error",
      lastError: "Temporary provider failure",
    });

    expect(
      isBrainSourceDue(failedSource, Date.parse(FAILED_AT) + POLL_INTERVAL_MS),
    ).toBe(true);
  });

  it("makes a never-synced active Zoom source due for auto-sync", () => {
    const zoomSource = source({ provider: "zoom", configJson: "{}" });

    expect(isBrainSourceDue(zoomSource, Date.parse(FAILED_AT))).toBe(true);
    expect(nextBrainSourceSyncAt(zoomSource)).not.toBeNull();
  });

  it("retries a transient classifier failure at its short retry time", () => {
    const retryAt = "2026-07-29T16:10:00.000Z";
    const failedSource = source({
      status: "error",
      cursorJson: JSON.stringify({ transientRetryAt: retryAt }),
    });

    expect(nextBrainSourceSyncAt(failedSource)).toBe(retryAt);
    expect(isBrainSourceDue(failedSource, Date.parse(retryAt))).toBe(true);
  });

  it.each(
    [5, 60].flatMap((pollMinutes) =>
      [5, 10, 20, 40].map((minutes, index) => ({
        pollMinutes,
        minutes,
        consecutiveTimeouts: index + 1,
      })),
    ),
  )(
    "retries a timed-out Zoom source after $minutes minutes with $pollMinutes-minute polling",
    ({ pollMinutes, minutes, consecutiveTimeouts }) => {
      const retryAt = new Date(
        Date.parse(FAILED_AT) + minutes * 60 * 1000,
      ).toISOString();
      const zoomSource = source({
        provider: "zoom",
        status: "error",
        configJson: JSON.stringify({ autoSync: true, pollMinutes }),
        cursorJson: JSON.stringify({
          transientRetryAt: retryAt,
          consecutiveTimeouts,
        }),
      });

      expect(nextBrainSourceSyncAt(zoomSource)).toBe(retryAt);
      expect(isBrainSourceDue(zoomSource, Date.parse(retryAt) - 1)).toBe(false);
      expect(isBrainSourceDue(zoomSource, Date.parse(retryAt))).toBe(true);
    },
  );

  it.each([5, 60])(
    "returns to %s-minute polling after Zoom exhausts its fast timeout retries",
    (pollMinutes) => {
      const zoomSource = source({
        provider: "zoom",
        status: "error",
        configJson: JSON.stringify({ autoSync: true, pollMinutes }),
        cursorJson: JSON.stringify({ consecutiveTimeouts: 5 }),
      });
      const dueAt = Date.parse(FAILED_AT) + pollMinutes * 60 * 1000;

      expect(nextBrainSourceSyncAt(zoomSource)).toBe(
        new Date(dueAt).toISOString(),
      );
      expect(isBrainSourceDue(zoomSource, dueAt - 1)).toBe(false);
      expect(isBrainSourceDue(zoomSource, dueAt)).toBe(true);
    },
  );

  it("keeps Zoom Retry-After later than a transient timeout retry", () => {
    const retryAfterAt = "2026-07-29T16:15:00.000Z";
    const zoomSource = source({
      provider: "zoom",
      status: "error",
      cursorJson: JSON.stringify({
        transientRetryAt: "2026-07-29T16:05:00.000Z",
        consecutiveTimeouts: 1,
        retry: { retryAfterAt },
      }),
    });

    expect(nextBrainSourceSyncAt(zoomSource)).toBe(retryAfterAt);
    expect(isBrainSourceDue(zoomSource, Date.parse(retryAfterAt) - 1)).toBe(
      false,
    );
    expect(isBrainSourceDue(zoomSource, Date.parse(retryAfterAt))).toBe(true);
  });

  it("does not postpone normal polling for a Zoom classifier failure", () => {
    const zoomSource = source({
      provider: "zoom",
      status: "error",
      configJson: JSON.stringify({ autoSync: true, pollMinutes: 5 }),
      cursorJson: JSON.stringify({
        transientRetryAt: "2026-07-29T16:10:00.000Z",
      }),
    });

    expect(nextBrainSourceSyncAt(zoomSource)).toBe("2026-07-29T16:05:00.000Z");
    expect(
      isBrainSourceDue(zoomSource, Date.parse(FAILED_AT) + 5 * 60 * 1000),
    ).toBe(true);
  });

  it("ignores a transient retry time on a source that is not in error", () => {
    const activeSource = source({
      lastSyncedAt: FAILED_AT,
      cursorJson: JSON.stringify({
        transientRetryAt: "2026-07-29T16:10:00.000Z",
      }),
    });

    expect(nextBrainSourceSyncAt(activeSource)).toBe(
      "2026-07-29T17:00:00.000Z",
    );
  });

  it("keeps paused and non-polling sources out of automatic retries", () => {
    const now = Date.parse(FAILED_AT) + POLL_INTERVAL_MS;

    expect(isBrainSourceDue(source({ status: "paused" }), now)).toBe(false);
    expect(
      isBrainSourceDue(source({ status: "error", provider: "manual" }), now),
    ).toBe(false);
  });
});
describe("collectDueSources", () => {
  const now = Date.parse(FAILED_AT) + POLL_INTERVAL_MS;
  const pageOf = (rows: ReturnType<typeof source>[]) => {
    const sorted = [...rows].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    return async ({ afterId, upToId }: SourceScanPage) =>
      sorted
        .filter(
          (row) =>
            (afterId === null || row.id > afterId) &&
            (upToId === null || row.id <= upToId),
        )
        .slice(0, 100);
  };
  const neverDue = (count: number, prefix: string) =>
    Array.from({ length: count }, (_, index) =>
      source({
        id: prefix + String(index).padStart(4, "0"),
        provider: "slack",
        configJson: JSON.stringify({ autoSync: false }),
      }),
    );

  it("finds a due source behind many never-due rows", async () => {
    const due = source({ id: "z-slack", provider: "slack", configJson: "{}" });

    const result = await collectDueSources(
      pageOf([...neverDue(150, "a-"), due]),
      5,
      now,
      "0",
    );

    expect(result.sources.map((row) => row.id)).toEqual(["z-slack"]);
    expect(result.truncated).toBe(false);
  });

  it("wraps past the end so sources before the pivot are still found", async () => {
    const rows = [
      source({ id: "b-due", provider: "slack", configJson: "{}" }),
      source({ id: "m-pivot", provider: "slack", configJson: "{}" }),
      ...neverDue(3, "x-"),
    ];

    const result = await collectDueSources(pageOf(rows), 5, now, "m-pivot");

    expect(result.sources.map((row) => row.id)).toEqual(["b-due", "m-pivot"]);
    expect(result.truncated).toBe(false);
  });

  it("reaches a source hidden behind the row cap once the pivot moves", async () => {
    const rows = [
      ...neverDue(2500, "a-"),
      source({ id: "z-slack", provider: "slack", configJson: "{}" }),
    ];

    const fromStart = await collectDueSources(pageOf(rows), 5, now, "0");
    const fromLater = await collectDueSources(pageOf(rows), 5, now, "a-1500");

    expect(fromStart).toEqual({ sources: [], truncated: true });
    expect(fromLater.sources.map((row) => row.id)).toEqual(["z-slack"]);
  });

  it("stops once it has enough due sources", async () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      source({ id: "s-" + index, provider: "slack", configJson: "{}" }),
    );

    const result = await collectDueSources(pageOf(rows), 5, now);

    expect(result.sources).toHaveLength(5);
  });

  it("reports a truncated scan instead of claiming completeness", async () => {
    const endless = async () =>
      Array.from({ length: 100 }, (_, index) =>
        source({
          id: "n-" + Math.random() + "-" + index,
          configJson: JSON.stringify({ autoSync: false }),
        }),
      );

    const result = await collectDueSources(endless, 5, now);

    expect(result).toEqual({ sources: [], truncated: true });
  });
});
