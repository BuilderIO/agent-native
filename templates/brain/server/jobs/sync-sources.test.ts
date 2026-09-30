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
