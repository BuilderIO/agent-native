import type { EmbedVisibility } from "@agent-native/core/shared";
import type { AnalyticsChartData } from "@shared/analytics-chart-block";
import { describe, expect, it } from "vitest";

import {
  analyticsShareAsks,
  analyticsShareCheck,
  SUB_PAGE_CHARTS_FRESH_MS,
  subPageChartsNeedReading,
  subPageChartsRead,
} from "./analytics-chart-share";

function chart(
  dashboard: EmbedVisibility,
  type: AnalyticsChartData["panel"]["type"] = "line",
): Pick<AnalyticsChartData, "panel" | "dashboard"> {
  return {
    dashboard: {
      id: `${dashboard}-dashboard`,
      title: `${dashboard} dashboard`,
      url: "https://analytics.example.test/dashboards/growth",
      visibility: dashboard,
    },
    panel: {
      id: "wau",
      title: "Weekly active users",
      type,
      fingerprint: "0123456789ab",
      url: "https://analytics.example.test/dashboards/growth?tile=wau",
    },
  };
}

const NONE = { charts: [], unread: false };

describe("analyticsShareCheck", () => {
  it("asks before making a page public when a sub-page holds a chart from a dashboard fewer people can open", () => {
    const check = analyticsShareCheck("public", NONE, {
      charts: [chart("org")],
      unread: false,
    });
    expect(check.page.warn).toEqual([]);
    expect(check.subPages?.warn.map((c) => c.dashboard.title)).toEqual([
      "org dashboard",
    ]);
    expect(analyticsShareAsks(check)).toBe(true);
  });

  it("counts a sub-page's table as one that will be refused", () => {
    const check = analyticsShareCheck("public", NONE, {
      charts: [chart("org", "table")],
      unread: false,
    });
    expect(check.subPages?.block).toHaveLength(1);
    expect(analyticsShareAsks(check)).toBe(true);
  });

  it("leaves sub-pages out of a change that doesn't make the page public", () => {
    const check = analyticsShareCheck("org", NONE, {
      charts: [chart("private")],
      unread: true,
    });
    expect(check.subPages).toBeNull();
    expect(analyticsShareAsks(check)).toBe(false);
  });

  it("asks while the sub-pages haven't been read", () => {
    const check = analyticsShareCheck("public", NONE, {
      charts: [],
      unread: true,
    });
    expect(check.subPages?.unread).toBe(true);
    expect(analyticsShareAsks(check)).toBe(true);
  });

  it("doesn't ask when every chart's dashboard is open as widely", () => {
    const check = analyticsShareCheck(
      "public",
      { charts: [chart("public")], unread: false },
      { charts: [chart("public", "table")], unread: false },
    );
    expect(analyticsShareAsks(check)).toBe(false);
  });

  it("still weighs the page's own charts", () => {
    const check = analyticsShareCheck(
      "org",
      { charts: [chart("private")], unread: false },
      NONE,
    );
    expect(check.page.warn).toHaveLength(1);
    expect(analyticsShareAsks(check)).toBe(true);
  });
});

describe("subPageChartsRead", () => {
  const whole = { charts: [chart("org")], unreadable: 0, more: false };
  const settled = { isError: false, isFetching: false };

  it("weighs a whole answer", () => {
    expect(subPageChartsRead({ data: whole, ...settled })).toEqual({
      charts: whole.charts,
      unread: false,
    });
  });

  it("keeps the sub-pages unread until there's a whole answer to weigh", () => {
    for (const query of [
      { data: undefined, ...settled },
      { data: {}, ...settled },
      { data: whole, isError: false, isFetching: true },
      // A failed refetch keeps the earlier answer, which may be out of date.
      { data: whole, isError: true, isFetching: false },
      { data: { ...whole, unreadable: 1 }, ...settled },
      { data: { ...whole, more: true }, ...settled },
    ]) {
      expect(subPageChartsRead(query)).toEqual({ charts: [], unread: true });
    }
  });
});

describe("subPageChartsNeedReading", () => {
  it("reads the sub-pages again before going public on an older answer", () => {
    const readAt = 1_000_000;
    expect(subPageChartsNeedReading(readAt, readAt + 1_000)).toBe(false);
    expect(
      subPageChartsNeedReading(readAt, readAt + SUB_PAGE_CHARTS_FRESH_MS + 1),
    ).toBe(true);
    // No answer yet.
    expect(subPageChartsNeedReading(0, readAt)).toBe(true);
  });
});
