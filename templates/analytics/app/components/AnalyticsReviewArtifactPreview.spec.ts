import { describe, expect, it } from "vitest";

import {
  firstReviewDashboardPanel,
  reviewDashboardFilters,
  reviewDashboardVariables,
} from "./AnalyticsReviewArtifactPreview";

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
});
