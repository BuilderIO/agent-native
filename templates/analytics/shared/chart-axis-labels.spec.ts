import { describe, expect, it } from "vitest";

import {
  axisDirection,
  estimateTextWidth,
  isCategoryAxis,
  isDateAxis,
  planCategoryAxis,
  trimToWidth,
} from "./chart-axis-labels";

const APPS = [
  "analytics",
  "assets",
  "brain",
  "calendar",
  "chat",
  "clips",
  "content",
  "design",
  "dispatch",
  "forms",
  "mail",
  "plan",
  "slides",
];

describe("isCategoryAxis", () => {
  it("treats dates, timestamps and numbers as ordinal", () => {
    expect(isCategoryAxis(["2026-09-08", "2026-09-09"])).toBe(false);
    expect(isCategoryAxis(["2026-09-08 00:00", "2026-09-08T01:00:00Z"])).toBe(
      false,
    );
    expect(isCategoryAxis(["20260908", new Date(), 3, "12"])).toBe(false);
    expect(isCategoryAxis([null, "", "2026-09"])).toBe(false);
  });

  it("treats weeks, quarters and month-name dates as ordinal", () => {
    expect(isCategoryAxis(["2026-W40", "2026W41"])).toBe(false);
    expect(isCategoryAxis(["2025-Q3", "Q4 2025"])).toBe(false);
    expect(isCategoryAxis(["Oct 01", "Oct 2", "Sep 30, 2026"])).toBe(false);
    expect(isCategoryAxis(["1 Oct 2026", "September 2026"])).toBe(false);
  });

  it("does not read words that start with a month as dates", () => {
    expect(isCategoryAxis(["Marketing", "Nova", "Octopus"])).toBe(true);
    expect(isCategoryAxis(["Juniper", "Decks"])).toBe(true);
  });
});

describe("isDateAxis", () => {
  it("is true only when every present value is a date or period", () => {
    expect(isDateAxis([null, "2026-09-08", "2026-W40", "Oct 01"])).toBe(true);
    expect(isDateAxis(["2026-09-08", 3])).toBe(false);
    expect(isDateAxis([101, 102, "103"])).toBe(false);
    expect(isDateAxis(["mail"])).toBe(false);
    expect(isDateAxis([null, ""])).toBe(false);
  });

  it("reads eight digits as a date only when they form a calendar date", () => {
    expect(isDateAxis(["20260908", "20261231"])).toBe(true);
    expect(isDateAxis(["10000001", "10000002"])).toBe(false);
    expect(isDateAxis(["20261301"])).toBe(false);
    expect(isDateAxis(["20260900"])).toBe(false);
    expect(isCategoryAxis(["10000001", "10000002"])).toBe(false);
  });

  it("reads which way an axis runs from its first and last values", () => {
    expect(axisDirection(["2026-10-04", "2026-09-09"])).toBe("descending");
    expect(axisDirection(["2026-09-09", null, "2026-10-04"])).toBe("ascending");
    expect(axisDirection([3, 2, 1])).toBe("descending");
    expect(axisDirection(["2026-W40", "2025-W02"])).toBe("descending");
    expect(axisDirection(["Q1 2025", "2025-Q4"])).toBe("ascending");
    expect(
      axisDirection([new Date("2026-10-04"), new Date("2026-09-09")]),
    ).toBe("descending");
    expect(axisDirection(["20260909", "20261004"])).toBe("ascending");
    expect(axisDirection(["20260930", "2026-10-01"])).toBe("ascending");
    expect(axisDirection([new Date("2026-09-30"), "2026-10-01"])).toBe(
      "ascending",
    );
    // 20:00 UTC, then 22:00 UTC, though the text sorts the other way.
    expect(
      axisDirection(["2026-10-02T01:00:00+05:00", "2026-10-01T22:00:00Z"]),
    ).toBe("ascending");
    expect(axisDirection(["2026-10-01 23:00", "2026-10-02T00:30:00Z"])).toBe(
      "ascending",
    );
    expect(axisDirection(["2026-13-45", "2026-10-01"])).toBeNull();
    expect(axisDirection(["Sep 30, 2026", "Oct 1, 2026", "2026-10-02"])).toBe(
      "ascending",
    );
    expect(axisDirection(["2 Oct 2026", "30 Sept 2026"])).toBe("descending");
    expect(axisDirection(["September 2026", "October 2026", "Jan 2027"])).toBe(
      "ascending",
    );
    expect(axisDirection(["Feb 30, 2026", "Mar 1, 2026"])).toBeNull();
    expect(axisDirection(["2026-09-09", "2026-09-09"])).toBe("ascending");
  });

  it("knows no direction for month names, mixed or out-of-order values", () => {
    expect(axisDirection(["Oct 04", "Sep 09"])).toBeNull();
    expect(axisDirection(["2026-10-04", 3])).toBeNull();
    expect(axisDirection([])).toBeNull();
    expect(
      axisDirection(["2026-09-01", "2026-10-09", "2026-09-20", "2026-10-04"]),
    ).toBeNull();
    expect(axisDirection(["2026-09-01", "2026-09-01", "2026-09-02"])).toBe(
      "ascending",
    );
  });

  it("treats any named value as a category", () => {
    expect(isCategoryAxis(["mail", "slides"])).toBe(true);
    expect(isCategoryAxis(["2026-09-08", "unknown"])).toBe(true);
  });
});

describe("planCategoryAxis", () => {
  it("keeps short labels level when they fit", () => {
    expect(planCategoryAxis(["a", "b", "c"], 600, 60, 12)).toEqual({
      angle: 0,
      interval: 0,
      height: 30,
      labelWidth: 200,
    });
  });

  it("angles 13 app names in a one-third-width card at about -35 degrees", () => {
    const plan = planCategoryAxis(APPS, 330, 60, 12);
    expect(plan.angle).toBe(-35);
    expect(plan.interval).toBe(0);
    expect(plan.height).toBeLessThanOrEqual(96);
  });

  it("stands crowded labels upright before it skips any", () => {
    const domains = Array.from(
      { length: 25 },
      (_, index) => `referrer-${index}.example.com`,
    );
    const plan = planCategoryAxis(domains, 330, 60, 12);
    expect(plan.angle).toBe(-90);
    expect(plan.interval).toBe(0);
  });

  it("skips labels only when even upright ones would overlap", () => {
    const labels = Array.from({ length: 100 }, (_, index) => `item ${index}`);
    const plan = planCategoryAxis(labels, 300, 60, 12);
    expect(plan.angle).toBe(-90);
    expect(plan.interval).toBeGreaterThan(0);
  });

  it("caps the label width so the first angled label stays on the chart", () => {
    const plan = planCategoryAxis(
      ["a very long category name that keeps going", "b"],
      120,
      20,
      12,
    );
    expect(plan.angle).toBe(-35);
    // The first tick sits half a slot (30px) right of the 20px inset.
    expect(plan.labelWidth * Math.cos((35 * Math.PI) / 180)).toBeCloseTo(50);
  });
});

describe("trimToWidth", () => {
  it("ends a cut label with the ellipsis", () => {
    const trimmed = trimToWidth("referrer-number-1.example.com", 12, 60, "…");
    expect(trimmed.endsWith("…")).toBe(true);
    expect(estimateTextWidth(trimmed, 12)).toBeLessThanOrEqual(60);
  });

  it("never cuts an emoji in half", () => {
    const label = "Launch 🚀🚀🚀🚀🚀🚀🚀🚀";
    for (let width = 20; width < estimateTextWidth(label, 12); width += 2) {
      const trimmed = trimToWidth(label, 12, width, "…");
      expect(trimmed).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    }
  });

  it("keeps the longest prefix that fits, without trailing spaces", () => {
    expect(trimToWidth("ab cd ef", 10, 20, "…")).toBe("ab…");
    const url = `https://example.com/${"segment/".repeat(5000)}`;
    const trimmed = trimToWidth(url, 12, 120, "…");
    expect(trimmed.startsWith("https://example")).toBe(true);
    expect(estimateTextWidth(trimmed, 12)).toBeLessThanOrEqual(120);
  });
});
