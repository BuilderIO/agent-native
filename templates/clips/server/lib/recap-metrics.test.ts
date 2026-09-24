import { describe, expect, it } from "vitest";

import {
  previousRecapMonth,
  rankTopClip,
  recapMonthLabel,
  recapMonthRange,
} from "./recap-metrics.js";

describe("recapMonthRange", () => {
  it("produces a half-open UTC range and rolls the year over", () => {
    expect(recapMonthRange("2026-07")).toEqual({
      month: "2026-07",
      startAt: "2026-07-01T00:00:00.000Z",
      endAt: "2026-08-01T00:00:00.000Z",
    });
    expect(recapMonthRange("2026-12")).toMatchObject({
      startAt: "2026-12-01T00:00:00.000Z",
      endAt: "2027-01-01T00:00:00.000Z",
    });
  });

  it("rejects a malformed month rather than silently picking one", () => {
    expect(() => recapMonthRange("2026-13")).toThrow(/Invalid recap month/);
    expect(() => recapMonthRange("july")).toThrow(/Invalid recap month/);
  });
});

describe("previousRecapMonth", () => {
  it("returns the month that just closed, including across a year boundary", () => {
    expect(previousRecapMonth(new Date("2026-08-01T14:00:00.000Z"))).toBe(
      "2026-07",
    );
    expect(previousRecapMonth(new Date("2027-01-01T14:00:00.000Z"))).toBe(
      "2026-12",
    );
  });
});

describe("recapMonthLabel", () => {
  it("names the month in UTC so the label cannot drift a day early", () => {
    expect(recapMonthLabel("2026-07")).toBe("July");
    expect(recapMonthLabel("2026-01")).toBe("January");
  });
});

describe("rankTopClip", () => {
  it("ranks on total audience and breaks ties on the newer recording", () => {
    const top = rankTopClip([
      { recordingId: "a", audience: 4, recordedAt: "2026-07-01T00:00:00Z" },
      { recordingId: "b", audience: 9, recordedAt: "2026-07-02T00:00:00Z" },
      { recordingId: "c", audience: 9, recordedAt: "2026-07-20T00:00:00Z" },
    ]);
    expect(top?.recordingId).toBe("c");
  });

  it("returns null with no candidates", () => {
    expect(rankTopClip([])).toBeNull();
  });
});
