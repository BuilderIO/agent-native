import type {
  DashboardFilter,
  SqlPanel,
} from "@agent-native/toolkit/dashboard/sql-dashboard-types";
import { describe, expect, it } from "vitest";

import {
  dashboardFiltersWithTraffic,
  dashboardTrafficEnvironment,
  reportFiltersWithTraffic,
  withOfferedTraffic,
} from "./traffic-filter";

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
  // raw-sql-ok: spec fixture; the filter only reads this SQL as text and never runs it.
  const reading = (sql: string) =>
    ({ id: "p", source: "first-party", sql }) as unknown as SqlPanel;

  it("leaves the filter off a dashboard whose panels read no table it narrows", () => {
    const shown = dashboardFiltersWithTraffic(
      [timeRange, savedTraffic],
      [
        reading("SELECT day FROM analytics_content_metric_snapshots"),
        reading("SELECT title FROM analytics_content_items"),
      ],
      labels,
    );

    expect(shown.map((filter) => filter.id)).toEqual(["timeRange"]);
  });

  it.each([
    "SELECT count(*) FROM analytics_events",
    "SELECT day FROM analytics_event_daily_rollups",
    "SELECT day FROM ANALYTICS_USER_DAYS",
    "SELECT id FROM session_recordings",
  ])("offers the filter when one panel runs %s", (query) => {
    const shown = dashboardFiltersWithTraffic(
      [timeRange],
      [reading("SELECT title FROM analytics_content_items"), reading(query)],
      labels,
    );

    expect(shown.map((filter) => filter.id)).toEqual([
      "timeRange",
      "traffic_environment",
    ]);
  });

  it("does not take a longer table name for one the filter narrows", () => {
    expect(
      dashboardFiltersWithTraffic(
        [timeRange],
        [reading("SELECT 1 FROM analytics_events_archive")],
        labels,
      ).map((filter) => filter.id),
    ).toEqual(["timeRange"]);
  });

  it("reads a table named by a dashboard variable or a filter's values", () => {
    expect(
      dashboardFiltersWithTraffic(
        [timeRange],
        [reading("SELECT count(*) FROM {{eventsTable}}")],
        labels,
        { eventsTable: "analytics_events" },
      ).map((filter) => filter.id),
    ).toEqual(["timeRange", "traffic_environment"]);
    expect(
      dashboardFiltersWithTraffic(
        [
          timeRange,
          {
            id: "source",
            label: "Source",
            type: "select",
            options: [
              { value: "analytics_content_items", label: "Articles" },
              { value: "session_recordings", label: "Replays" },
            ],
          },
        ],
        [reading("SELECT count(*) FROM {{source}}")],
        labels,
      ).map((filter) => filter.id),
    ).toEqual(["timeRange", "source", "traffic_environment"]);
  });

  it("leaves the filter off when variables name other tables", () => {
    expect(
      dashboardFiltersWithTraffic(
        [timeRange],
        [
          reading(
            "SELECT count(*) FROM {{itemsTable}} WHERE '{{timeRange}}' != ''",
          ),
        ],
        labels,
        { itemsTable: "analytics_content_items" },
      ).map((filter) => filter.id),
    ).toEqual(["timeRange"]);
  });

  it("reads a filter's values over a variable of the same name", () => {
    expect(
      dashboardFiltersWithTraffic(
        [
          {
            id: "source",
            label: "Source",
            type: "select",
            default: "analytics_content_items",
            options: [
              { value: "analytics_content_items", label: "Articles" },
              { value: "session_recordings", label: "Replays" },
            ],
          },
        ],
        [reading("SELECT count(*) FROM {{source}}")],
        labels,
        { source: "analytics_content_items" },
      ).map((filter) => filter.id),
    ).toEqual(["source", "traffic_environment"]);
    expect(
      dashboardFiltersWithTraffic(
        [
          {
            id: "source",
            label: "Source",
            type: "select",
            options: [{ value: "analytics_content_items", label: "Articles" }],
          },
        ],
        [reading("SELECT count(*) FROM {{source}}")],
        labels,
        { source: "analytics_events" },
      ).map((filter) => filter.id),
    ).toEqual(["source"]);
  });

  it("reads a table name built from SQL text and a placeholder", () => {
    expect(
      dashboardFiltersWithTraffic(
        [
          {
            id: "kind",
            label: "Kind",
            type: "select",
            options: [
              { value: "content_items", label: "Articles" },
              { value: "events", label: "Events" },
            ],
          },
        ],
        [reading("SELECT count(*) FROM analytics_{{kind}}")],
        labels,
      ).map((filter) => filter.id),
    ).toEqual(["kind", "traffic_environment"]);
    expect(
      dashboardFiltersWithTraffic(
        [timeRange],
        [reading("SELECT count(*) FROM {{prefix}}_events")],
        labels,
        { prefix: "analytics" },
      ).map((filter) => filter.id),
    ).toEqual(["timeRange", "traffic_environment"]);
  });

  it("offers the filter when a reader can type any table name", () => {
    expect(
      dashboardFiltersWithTraffic(
        [{ id: "table", label: "Table", type: "text" }],
        [reading("SELECT count(*) FROM {{table}}")],
        labels,
        { table: "analytics_content_items" },
      ).map((filter) => filter.id),
    ).toEqual(["table", "traffic_environment"]);
  });

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

describe("withOfferedTraffic", () => {
  it("reads a traffic value the filter doesn't offer as the dashboard's default", () => {
    expect(
      withOfferedTraffic({ traffic_environment: "staging", app: "slides" }, [
        savedTraffic,
      ]),
    ).toEqual({ traffic_environment: "production", app: "slides" });
  });

  it.each(["all", "production", "beta"])("keeps %s as chosen", (value) => {
    expect(
      withOfferedTraffic({ traffic_environment: value }, [savedTraffic]),
    ).toEqual({ traffic_environment: value });
  });

  it("leaves values alone on a dashboard that doesn't show the filter", () => {
    expect(
      withOfferedTraffic({ traffic_environment: "staging" }, [timeRange]),
    ).toEqual({ traffic_environment: "staging" });
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
