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
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.id === "recharts_measurement_span") {
        return {
          width: this.textContent.length * 7,
          height: 12,
        } as DOMRect;
      }
      return {
        ...CHART_SIZE,
        top: 0,
        left: 0,
        right: 640,
        bottom: 320,
      } as DOMRect;
    };
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

  it("stacks combo bars under a target line on its own axis and groups them by default", async () => {
    const rows = [
      { day: "2026-10-11", north: 30, south: 20, target: 500 },
      { day: "2026-10-12", north: 40, south: 30, target: 1000 },
    ];
    const config = {
      xKey: "day",
      yKeys: ["north", "south", "target"],
      barKeys: ["north", "south"],
      rightYKeys: ["target"],
    };
    const rectangles = () =>
      [...container.querySelectorAll(".recharts-bar-rectangle path")].map(
        (path) => ({
          x: Number(path.getAttribute("x")),
          y: Number(path.getAttribute("y")),
          width: Number(path.getAttribute("width")),
          height: Number(path.getAttribute("height")),
        }),
      );

    await render(
      <DashboardPanelChart
        panel={panel("combo", { ...config, stacked: true })}
        rows={rows}
      />,
    );
    const stacked = rectangles();
    expect(stacked).toHaveLength(4);
    const [northFirst, northSecond, southFirst] = stacked;
    expect(northFirst.height).toBeGreaterThan(0);
    expect(southFirst.height).toBeGreaterThan(0);
    expect(northFirst.x).toBeCloseTo(southFirst.x);
    expect(northFirst.width).toBeCloseTo(southFirst.width);
    expect(southFirst.y + southFirst.height).toBeCloseTo(northFirst.y);
    const targetLine = container
      .querySelector(".recharts-line-curve")
      ?.getAttribute("d");
    const points = targetLine?.match(/^M([\d.]+),([\d.]+)L([\d.]+),([\d.]+)$/);
    if (!points) throw new Error("Missing target line");
    const [, x1, y1, x2, y2] = points.map(Number);
    const grid = [
      ...container.querySelectorAll(".recharts-cartesian-grid-horizontal line"),
    ].map((line) => Number(line.getAttribute("y1")));
    expect(grid).toHaveLength(2);
    const [top, bottom] = grid;
    expect(container.querySelectorAll(".recharts-yAxis")).toHaveLength(2);
    expect(x1).toBeCloseTo(northFirst.x + northFirst.width / 2);
    expect(x2).toBeCloseTo(northSecond.x + northSecond.width / 2);
    expect(y1).toBeCloseTo((top + bottom) / 2);
    expect(y2).toBeCloseTo(top);

    await render(
      <DashboardPanelChart panel={panel("combo", config)} rows={rows} />,
    );
    const grouped = rectangles();
    expect(grouped).toHaveLength(4);
    const [groupNorth, , groupSouth] = grouped;
    expect(groupNorth.x).not.toBeCloseTo(groupSouth.x);
    expect(groupNorth.y + groupNorth.height).toBeCloseTo(
      groupSouth.y + groupSouth.height,
    );
    expect(
      container.querySelector(".recharts-line-curve")?.getAttribute("d"),
    ).toBe(targetLine);
  });

  it("stacks positive and negative combo bars on opposite sides of zero", async () => {
    const config = {
      xKey: "day",
      yKeys: ["positive", "negative", "morePositive", "moreNegative", "target"],
      barKeys: ["positive", "negative", "morePositive", "moreNegative"],
    };
    const rows = [
      {
        day: "2026-10-11",
        positive: 30,
        negative: -20,
        morePositive: 10,
        moreNegative: -10,
        target: 5,
      },
    ];
    const bars = () =>
      [...container.querySelectorAll(".recharts-bar-rectangle path")].map(
        (path) => {
          const y = Number(path.getAttribute("y"));
          const height = Number(path.getAttribute("height"));
          return {
            x: Number(path.getAttribute("x")),
            y: Math.min(y, y + height),
            height: Math.abs(height),
          };
        },
      );

    await render(
      <DashboardPanelChart
        panel={panel("combo", { ...config, stacked: true })}
        rows={rows}
      />,
    );
    const [positive, negative, morePositive, moreNegative] = bars();
    expect(bars()).toHaveLength(4);
    expect(positive.height).toBeGreaterThan(0);
    expect(negative.height).toBeGreaterThan(0);
    expect(morePositive.height).toBeGreaterThan(0);
    expect(moreNegative.height).toBeGreaterThan(0);
    expect(positive.x).toBeCloseTo(negative.x);
    expect(negative.y).toBeCloseTo(positive.y + positive.height);
    expect(morePositive.y + morePositive.height).toBeCloseTo(positive.y);
    expect(moreNegative.y).toBeCloseTo(negative.y + negative.height);

    await render(
      <DashboardPanelChart panel={panel("combo", config)} rows={rows} />,
    );
    const [groupedPositive, groupedNegative] = bars();
    expect(groupedPositive.x).not.toBeCloseTo(groupedNegative.x);
    expect(groupedNegative.y).toBeCloseTo(
      groupedPositive.y + groupedPositive.height,
    );
  });

  it("positions stacks on different value axes side by side", async () => {
    await render(
      <DashboardPanelChart
        panel={panel("combo", {
          xKey: "day",
          yKeys: ["north", "south", "east", "west", "target"],
          barKeys: ["north", "south", "east", "west"],
          rightYKeys: ["east", "west", "target"],
          stacked: true,
        })}
        rows={[
          {
            day: "2026-10-11",
            north: 30,
            south: 20,
            east: 40,
            west: 30,
            target: 100,
          },
        ]}
      />,
    );
    const bars = [
      ...container.querySelectorAll(".recharts-bar-rectangle path"),
    ].map((path) => ({
      x: Number(path.getAttribute("x")),
      y: Number(path.getAttribute("y")),
      width: Number(path.getAttribute("width")),
      height: Number(path.getAttribute("height")),
    }));
    expect(bars).toHaveLength(4);
    const [north, south, east, west] = bars;
    expect(north.x).toBeCloseTo(south.x);
    expect(south.y + south.height).toBeCloseTo(north.y);
    expect(east.x).toBeCloseTo(west.x);
    expect(west.y + west.height).toBeCloseTo(east.y);
    expect(north.x + north.width).toBeLessThanOrEqual(east.x);
  });

  it("sizes duration axes to visible stacked bars and independent lines", async () => {
    const hour = 3600;
    const config = {
      xKey: "day",
      yKeys: ["north", "south", "east", "west", "target"],
      barKeys: ["north", "south", "east", "west"],
      rightYKeys: ["east", "west", "target"],
      yFormatter: "duration" as const,
      rightYFormatter: "duration" as const,
      stacked: true,
    };
    const row = {
      day: "2026-10-11",
      north: 6 * hour,
      south: 6 * hour,
      east: 12 * hour,
      west: 12 * hour,
      target: 15 * hour,
    };
    await render(
      <DashboardPanelChart panel={panel("combo", config)} rows={[row]} />,
    );
    const labels = () =>
      [...container.querySelectorAll(".recharts-yAxis-tick-labels")].map(
        (axis) =>
          [...axis.querySelectorAll(".recharts-cartesian-axis-tick-value")].map(
            (tick) => tick.textContent,
          ),
      );
    expect(labels()).toEqual([
      ["0 sec", "3 hours", "6 hours", "9 hours", "12 hours"],
      ["0 sec", "6 hours", "12 hours", "18 hours", "24 hours"],
    ]);
    await render(
      <DashboardPanelChart
        panel={panel("combo", config)}
        rows={[{ ...row, target: 30 * hour }]}
      />,
    );
    expect(labels()[1]).toEqual(["0 sec", "12 hours", "24 hours", "36 hours"]);
    const south = container.querySelector<HTMLButtonElement>(
      '[data-chart-legend-item="south"]',
    );
    if (!south) throw new Error("Missing south legend item");
    await act(async () => south.click());
    expect(labels()[0]).toEqual(["0 sec", "2 hours", "4 hours", "6 hours"]);
  });

  it("uses the same duration scale as stacked bars without stacking the line", async () => {
    const hour = 3600;
    const rows = [
      { day: "2026-10-11", north: 6 * hour, south: 6 * hour, target: 3 * hour },
    ];
    const config = {
      xKey: "day",
      yKeys: ["north", "south", "target"],
      barKeys: ["north", "south"],
      yFormatter: "duration" as const,
    };
    const labels = () =>
      [
        ...container.querySelectorAll(
          ".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value",
        ),
      ].map((tick) => tick.textContent);

    await render(
      <DashboardPanelChart
        panel={panel("combo", { ...config, stacked: true })}
        rows={rows}
      />,
    );
    expect(labels()).toEqual([
      "0 sec",
      "3 hours",
      "6 hours",
      "9 hours",
      "12 hours",
    ]);

    await render(
      <DashboardPanelChart panel={panel("combo", config)} rows={rows} />,
    );
    expect(labels()).toEqual(["0 sec", "2 hours", "4 hours", "6 hours"]);
  });

  it("dashes the day the rows were read as unfinished, not today", async () => {
    const line = panel("line", { xKey: "day", yKeys: ["people"] });
    await render(<DashboardPanelChart panel={line} rows={DAYS} />);
    expect(container.querySelector('path[stroke-dasharray="3 5"]')).toBeNull();

    await render(
      <DashboardPanelChart
        panel={line}
        rows={DAYS}
        asOf="2026-10-14T20:00:00.000Z"
      />,
    );
    expect(
      container.querySelector('path[stroke-dasharray="3 5"]'),
    ).not.toBeNull();
  });

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

  it("draws nothing for an extension, or a section with no description", async () => {
    for (const chartType of ["section", "extension"] as const) {
      await render(
        <DashboardPanelChart panel={panel(chartType)} rows={DAYS} />,
      );
      expect(container.innerHTML).toBe("");
    }
  });

  it("shows a section's description and draws no rows", async () => {
    await render(
      <DashboardPanelChart
        panel={panel("section", { description: "Growth this quarter" })}
        rows={DAYS}
      />,
    );
    expect(container.textContent).toBe("Growth this quarter");
    expect(container.querySelector("svg")).toBeNull();
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
