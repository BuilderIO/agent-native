import { describe, expect, it } from "vitest";

import {
  normalizeReportFilterSnapshot,
  reportFilterSnapshotKey,
  savedReportFiltersForEdit,
} from "./report-filters";

describe("dashboard report filter snapshots", () => {
  it("normalizes filter snapshots before saving", () => {
    expect(
      normalizeReportFilterSnapshot({
        " f_country ": " US ",
        empty: "",
        blank: "   ",
      }),
    ).toEqual({ f_country: "US" });
  });

  it("uses a stable key independent of object insertion order", () => {
    expect(reportFilterSnapshotKey({ b: "2", a: "1" })).toBe(
      reportFilterSnapshotKey({ a: "1", b: "2" }),
    );
  });

  it("preserves saved filters when editing an existing subscription", () => {
    const saved = savedReportFiltersForEdit({ f_plan: "enterprise" });
    const currentPageFilters = normalizeReportFilterSnapshot({
      f_plan: "free",
    });

    expect(saved).toEqual({ f_plan: "enterprise" });
    expect(saved).not.toEqual(currentPageFilters);
  });
});
