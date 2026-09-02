import { describe, expect, it } from "vitest";

import {
  commandPathForNavigation,
  dataSourcesNavigationState,
  preserveActiveDashboardTab,
} from "./use-navigation-state";

describe("data source navigation", () => {
  it("extracts only the focused source as semantic navigation state", () => {
    expect(
      dataSourcesNavigationState(
        new URLSearchParams("source=dbt&returnTo=ask&metadata=ignored"),
      ),
    ).toEqual({ view: "data-sources", dataSourceId: "dbt" });
  });

  it("builds an encoded command path for the focused source", () => {
    expect(
      commandPathForNavigation({
        view: "data-sources",
        dataSourceId: "dbt/core",
      }),
    ).toBe("/data-sources?source=dbt%2Fcore");
  });

  it("preserves an existing command path including returnTo", () => {
    expect(
      commandPathForNavigation({
        view: "data-sources",
        dataSourceId: "dbt",
        path: "/data-sources?source=dbt&returnTo=ask",
      }),
    ).toBe("/data-sources?source=dbt&returnTo=ask");
  });
});

describe("preserveActiveDashboardTab", () => {
  it("keeps the active tab when an agent reopens the current dashboard", () => {
    expect(
      preserveActiveDashboardTab(
        "/dashboards/revenue",
        "/dashboards/revenue",
        "?tab=retention&f_date=30d",
      ),
    ).toBe("/dashboards/revenue?tab=retention");
  });

  it("handles the legacy adhoc route for the same dashboard", () => {
    expect(
      preserveActiveDashboardTab(
        "/dashboards/revenue",
        "/adhoc/revenue",
        "?tab=accounts",
      ),
    ).toBe("/dashboards/revenue?tab=accounts");
  });

  it("does not carry a tab to another dashboard", () => {
    expect(
      preserveActiveDashboardTab(
        "/dashboards/acquisition",
        "/dashboards/revenue",
        "?tab=retention",
      ),
    ).toBe("/dashboards/acquisition");
  });

  it("does not overwrite an explicit target query", () => {
    expect(
      preserveActiveDashboardTab(
        "/dashboards/revenue?view=weekly",
        "/dashboards/revenue",
        "?tab=retention",
      ),
    ).toBe("/dashboards/revenue?view=weekly");
  });
});
