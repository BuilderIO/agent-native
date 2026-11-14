// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SqlPanel } from "../../dashboard/sql-dashboard-types.js";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key} ${JSON.stringify(params)}` : key,
  useFormatters: () => ({
    formatNumber: (value: number) => value.toLocaleString("en-US"),
  }),
}));

import { DashboardPanelChart } from "./DashboardPanelChart.js";
import {
  DashboardPanelChartHostProvider,
  useDashboardPanelChartHost,
  type DashboardPanelChartHost,
} from "./panel-chart-host.js";

const CHART_SIZE = { width: 640, height: 320 };

const DAYS = [
  { day: "2026-10-11", people: 100 },
  { day: "2026-10-12", people: 110 },
  { day: "2026-10-13", people: 120 },
  { day: "2026-10-14", people: 130 },
];

function panel(
  chartType: SqlPanel["chartType"],
  config?: SqlPanel["config"],
): SqlPanel {
  return {
    id: "people",
    title: "New people",
    sql: "SELECT 1",
    source: "first-party",
    chartType,
    width: 1,
    config,
  };
}

describe("DashboardPanelChart", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    for (const [prop, value] of Object.entries(CHART_SIZE)) {
      Object.defineProperty(
        HTMLElement.prototype,
        prop === "width" ? "offsetWidth" : "offsetHeight",
        { configurable: true, value },
      );
    }
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({ ...CHART_SIZE, top: 0, left: 0, right: 640, bottom: 320 }) as DOMRect;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  async function render(node: ReactNode) {
    await act(async () => {
      root.render(node);
    });
  }

  it.each(["line", "area", "bar", "combo"] as const)(
    "marks the panel's own key dates on a %s chart with no app around it",
    async (chartType) => {
      await render(
        <DashboardPanelChart
          panel={panel(chartType, {
            xKey: "day",
            yKeys: ["people"],
            events: [
              { date: "2026-10-12", label: "Pricing change" },
              { date: "2026-10-14", label: "Launch" },
            ],
          })}
          rows={DAYS}
        />,
      );
      expect(container.querySelector(".recharts-wrapper")).not.toBeNull();
      expect(container.querySelectorAll("[data-event-marker]")).toHaveLength(2);
    },
  );

  it("draws a metric from its first row", async () => {
    await render(
      <DashboardPanelChart panel={panel("metric")} rows={[{ value: 1234 }]} />,
    );
    expect(container.textContent).toContain("1,234");
  });

  it("says there is no data when the rows are empty", async () => {
    await render(<DashboardPanelChart panel={panel("line")} rows={[]} />);
    expect(container.textContent).toContain("common.noData");
  });

  it("draws a table's rows", async () => {
    await render(
      <DashboardPanelChart
        panel={panel("table")}
        rows={[
          { path: "/pricing", views: 30 },
          { path: "/docs", views: 12 },
        ]}
      />,
    );
    expect(container.textContent).toContain("/pricing");
    expect(container.textContent).toContain("/docs");
  });

  it("links session cells to replays only when the app turns them on", async () => {
    const rows = [{ session_id: "s-1", views: 3 }];
    await render(<DashboardPanelChart panel={panel("table")} rows={rows} />);
    expect(container.querySelector("a[href]")).toBeNull();

    function WithReplays() {
      const host: DashboardPanelChartHost = {
        ...useDashboardPanelChartHost(),
        sessionReplays: true,
      };
      return (
        <MemoryRouter>
          <DashboardPanelChartHostProvider value={host}>
            <DashboardPanelChart panel={panel("table")} rows={rows} />
          </DashboardPanelChartHostProvider>
        </MemoryRouter>
      );
    }
    await render(<WithReplays />);
    expect(container.querySelector("a[href]")?.textContent).toContain(
      "sessions.watchReplay",
    );
  });

  it("draws nothing for a section or an extension", async () => {
    for (const chartType of ["section", "extension"] as const) {
      await render(
        <DashboardPanelChart panel={panel(chartType)} rows={DAYS} />,
      );
      expect(container.innerHTML).toBe("");
    }
  });

  it("shows the panel's description above it", async () => {
    await render(
      <DashboardPanelChart
        panel={panel("metric", { description: "Signups this week" })}
        rows={[{ value: 12 }]}
      />,
    );
    expect(container.textContent).toContain("Signups this week");
  });

  it("draws a pie's slices", async () => {
    await render(
      <DashboardPanelChart
        panel={panel("pie", { xKey: "browser", yKeys: ["visits"] })}
        rows={[
          { browser: "Chrome", visits: 10 },
          { browser: "Safari", visits: 5 },
        ]}
      />,
    );
    expect(container.querySelector(".recharts-pie")).not.toBeNull();
  });

  it("draws a funnel's stages", async () => {
    await render(
      <DashboardPanelChart
        panel={panel("funnel", { xKey: "stage", yKey: "users" })}
        rows={[
          { stage: "Visited", users: 100 },
          { stage: "Signed up", users: 40 },
        ]}
      />,
    );
    const funnel = container.querySelector("[data-dashboard-funnel]");
    expect(funnel?.textContent).toContain("Visited");
    expect(funnel?.textContent).toContain("Signed up");
  });

  it("draws a heatmap with a row for each value of its row column", async () => {
    await render(
      <DashboardPanelChart
        panel={panel("heatmap", {
          xKey: "week",
          yKey: "retained",
          color: "cohort",
        })}
        rows={[
          { week: "W1", cohort: "Sept", retained: 40 },
          { week: "W2", cohort: "Sept", retained: 31 },
          { week: "W1", cohort: "Oct", retained: 44 },
          { week: "W2", cohort: "Oct", retained: 35 },
        ]}
      />,
    );
    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual([
      "Sept",
      "Oct",
    ]);
  });

  it("draws a callout's message at its severity", async () => {
    await render(
      <DashboardPanelChart
        panel={panel("callout")}
        rows={[{ severity: "warning", message: "Spend is up" }]}
      />,
    );
    const callout = container.querySelector(
      '[data-callout-severity="warning"]',
    );
    expect(callout?.textContent).toContain("Spend is up");
  });

  it("says when a time series draws only its newest points", async () => {
    const start = Date.UTC(2025, 0, 1);
    const rows = Array.from({ length: 450 }, (_, index) => ({
      day: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
      people: index,
    }));
    await render(
      <DashboardPanelChart
        panel={panel("line", { xKey: "day", yKeys: ["people"] })}
        rows={rows}
      />,
    );
    expect(
      container.querySelector("[data-chart-point-limit]")?.textContent,
    ).toBe('sqlDashboard.chartPointLimitNewest {"shown":"400","total":"450"}');
  });
});
