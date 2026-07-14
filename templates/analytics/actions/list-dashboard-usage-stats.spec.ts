import { describe, expect, it } from "vitest";

import {
  dashboardIdFromEventLocation,
  dashboardIdFromPath,
} from "./list-dashboard-usage-stats";

describe("dashboard usage path parsing", () => {
  it("reads standard dashboard ids from path", () => {
    expect(dashboardIdFromPath("/dashboards/sql-1")).toBe("sql-1");
    expect(dashboardIdFromPath("/adhoc/legacy-1")).toBe("legacy-1");
  });

  it("reads explorer dashboard ids from url query strings", () => {
    expect(
      dashboardIdFromEventLocation(
        "/dashboards/explorer-dashboard",
        "/dashboards/explorer-dashboard?id=explorer-1",
      ),
    ).toBe("explorer-1");
    expect(
      dashboardIdFromEventLocation(
        "/dashboards/explorer-dashboard",
        "https://app.example.test/dashboards/explorer-dashboard?id=encoded%20id",
      ),
    ).toBe("encoded id");
  });
});
