import { describe, expect, it } from "vitest";

import { dashboardDataPanelId } from "./dashboard";
import type { CrmDashboardPanelConfig } from "./types";

const panels: CrmDashboardPanelConfig[] = [
  {
    id: "metric",
    title: "Pipeline value",
    source: "program",
    query: '{"programId":"pipeline"}',
    chartType: "metric",
  },
  {
    id: "bar",
    title: "Pipeline by stage",
    source: "program",
    query: '{"programId":"pipeline"}',
    chartType: "bar",
  },
  {
    id: "table",
    title: "Other pipeline",
    source: "program",
    query: '{"programId":"other"}',
    chartType: "table",
  },
];

describe("dashboardDataPanelId", () => {
  it("deduplicates panels backed by the same source and query", () => {
    expect(dashboardDataPanelId(panels, panels[1]!)).toBe("metric");
  });

  it("keeps a distinct program query on its own action key", () => {
    expect(dashboardDataPanelId(panels, panels[2]!)).toBe("table");
  });
});
