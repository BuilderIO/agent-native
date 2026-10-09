import { describe, expect, it } from "vitest";

import {
  SOURCE_INDEX_STALE_AFTER_DAYS,
  sourceIndexFreshness,
} from "./source-index-store";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("sourceIndexFreshness", () => {
  it("marks a revision-stamped index stale after the refresh window", () => {
    const now = Date.parse("2026-10-09T12:00:00.000Z");

    expect(
      sourceIndexFreshness(
        new Date(now - SOURCE_INDEX_STALE_AFTER_DAYS * DAY_MS).toISOString(),
        now,
      ),
    ).toEqual({ ageDays: 90, staleAfterDays: 90, stale: true });
  });

  it("does not call a newer index stale or report a future timestamp as negative age", () => {
    const now = Date.parse("2026-10-09T12:00:00.000Z");

    expect(
      sourceIndexFreshness(new Date(now - 89 * DAY_MS).toISOString(), now),
    ).toEqual({ ageDays: 89, staleAfterDays: 90, stale: false });
    expect(
      sourceIndexFreshness(new Date(now + DAY_MS).toISOString(), now),
    ).toEqual({ ageDays: 0, staleAfterDays: 90, stale: false });
  });

  it("rejects an invalid generated timestamp instead of reporting fresh", () => {
    expect(() => sourceIndexFreshness("invalid", Date.now())).toThrow(
      "source index timestamp is invalid",
    );
  });
});
