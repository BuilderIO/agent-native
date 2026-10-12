import { describe, expect, it } from "vitest";

import {
  estimateTextWidth,
  isCategoryAxis,
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
});
