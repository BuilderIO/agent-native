import { describe, expect, it } from "vitest";

import {
  dashboardFiltersWithTraffic,
  dashboardTrafficEnvironment,
  reportFiltersWithTraffic,
} from "./traffic-filter";
import type { DashboardFilter, SqlPanel } from "./types";

const labels = {
  label: "Verkehr",
  all: "Alle",
  production: "Produktion",
  beta: "Beta",
};
const panel = (source: string) => ({ id: "p", source }) as unknown as SqlPanel;
const timeRange: DashboardFilter = {
  id: "timeRange",
  label: "Time",
  type: "select",
};
const savedTraffic: DashboardFilter = {
  id: "traffic_environment",
  label: "Traffic",
  type: "select",
  default: "production",
};

describe("dashboardFiltersWithTraffic", () => {
  it("offers a dashboard saved without the filter all traffic by default", () => {
    const shown = dashboardFiltersWithTraffic(
      [timeRange],
      [panel("first-party")],
      labels,
    );

    expect(shown.map((filter) => filter.id)).toEqual([
      "timeRange",
      "traffic_environment",
    ]);
    expect(shown[1]).toMatchObject({ default: "all", label: "Verkehr" });
  });

  it("keeps the dashboard's own default, in the reader's language", () => {
    const [traffic] = dashboardFiltersWithTraffic(
      [savedTraffic],
      [panel("first-party")],
      labels,
    );

    expect(traffic).toMatchObject({ default: "production", label: "Verkehr" });
    expect(traffic?.options?.map((option) => option.label)).toEqual([
      "Alle",
      "Produktion",
      "Beta",
    ]);
  });

  it("hides the filter when no panel reads first-party data", () => {
    expect(
      dashboardFiltersWithTraffic(
        [timeRange, savedTraffic],
        [panel("bigquery")],
        labels,
      ),
    ).toEqual([timeRange]);
    expect(dashboardFiltersWithTraffic(undefined, [], labels)).toEqual([]);
  });
});

describe("reportFiltersWithTraffic", () => {
  const onAll: DashboardFilter = { ...savedTraffic, default: "all" };

  it("saves nothing for all traffic on a dashboard that defaults to it", () => {
    expect(
      reportFiltersWithTraffic(
        { f_traffic_environment: "all", f_app: "slides" },
        [onAll],
        { traffic_environment: "all" },
      ),
    ).toEqual({ f_app: "slides" });
  });

  it("saves a switch away from all traffic, read from what's on screen", () => {
    expect(
      reportFiltersWithTraffic({}, [onAll], {
        traffic_environment: "production",
      }),
    ).toEqual({ f_traffic_environment: "production" });
  });

  it("says all traffic out loud where the dashboard defaults to production", () => {
    expect(
      reportFiltersWithTraffic({}, [savedTraffic], {
        traffic_environment: "all",
      }),
    ).toEqual({ f_traffic_environment: "all" });
  });

  it("drops the filter when the dashboard doesn't show it", () => {
    expect(
      reportFiltersWithTraffic({ f_traffic_environment: "beta" }, [], {}),
    ).toEqual({});
  });
});

describe("dashboardTrafficEnvironment", () => {
  it("only names a filter for production or beta", () => {
    expect(
      dashboardTrafficEnvironment({ traffic_environment: "production" }),
    ).toBe("production");
    expect(
      dashboardTrafficEnvironment({ traffic_environment: "all" }),
    ).toBeUndefined();
    expect(dashboardTrafficEnvironment({})).toBeUndefined();
    expect(
      dashboardTrafficEnvironment({ traffic_environment: "staging" }),
    ).toBeUndefined();
  });
});
