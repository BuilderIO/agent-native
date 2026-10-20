import { describe, expect, it } from "vitest";

import {
  firstReviewDashboardPanel,
  reviewDashboardFilters,
  reviewDashboardVariables,
} from "./AnalyticsReviewArtifactPreview";

function panel(source: string, id = source) {
  return {
    id,
    title: id,
    sql: "SELECT 1",
    width: 1,
    source,
    chartType: "bar",
  };
}

describe("Analytics review artifact preview", () => {
  it("chooses the first visible chart rather than a layout section", () => {
    expect(
      firstReviewDashboardPanel({
        layout: { firstPanelIds: ["section", "chart"] },
        panels: [
          {
            id: "section",
            title: "Overview",
            sql: "",
            width: 12,
            source: "first-party",
            chartType: "section",
          },
          {
            id: "chart",
            title: "Weekly activity",
            sql: "select 1",
            width: 12,
            source: "first-party",
            chartType: "line",
          },
        ],
      }),
    ).toMatchObject({ id: "chart", title: "Weekly activity" });
  });

  it("fails closed on malformed saved filters and variables", () => {
    expect(reviewDashboardFilters({ filters: [{ id: "range" }] })).toBe(
      undefined,
    );
    expect(reviewDashboardVariables({ variables: { range: 14 } })).toBe(
      undefined,
    );
  });

  it("reads multi-select presets and fails closed on a malformed one", () => {
    const plan = {
      id: "plan",
      label: "Plan",
      type: "multi-select",
      options: [{ value: "free", label: "Free" }],
    };
    const presets = [{ label: "Free only", values: ["free"] }];

    expect(reviewDashboardFilters({ filters: [{ ...plan, presets }] })).toEqual(
      [{ ...plan, presets }],
    );
    for (const malformed of [
      { label: "Free only" },
      { label: 1, values: ["free"] },
      { label: "Free only", values: [1] },
    ]) {
      expect(
        reviewDashboardFilters({
          filters: [{ ...plan, presets: [malformed] }],
        }),
      ).toBe(undefined);
    }
  });

  it("skips synthetic and executable panels in favor of real saved charts", () => {
    const chart = panel("first-party", "real-chart");

    expect(
      firstReviewDashboardPanel({
        panels: [panel("program"), panel("demo"), chart],
      }),
    ).toEqual(chart);
  });

  it("does not present synthetic-only dashboards as real chart previews", () => {
    expect(
      firstReviewDashboardPanel({ panels: [panel("program"), panel("demo")] }),
    ).toBeUndefined();
  });

  it("keeps saved charts available when review previews disable query loading", () => {
    const chart = panel("bigquery");

    expect(firstReviewDashboardPanel({ panels: [chart] })).toEqual(chart);
  });
});
