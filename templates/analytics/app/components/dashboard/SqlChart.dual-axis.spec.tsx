// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useDemoModeStatus: () => ({
    enabled: false,
    forced: false,
    isLoading: false,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/lib/demo-chart-trend", () => ({
  createDemoChartTrendRows: (rows: Record<string, unknown>[]) => rows,
}));

vi.mock("@/lib/sql-query", () => ({
  useSqlQuery: () => ({
    data: { rows: mocks.rows },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@agent-native/core/client/extensions", () => ({
  EmbeddedExtension: () => null,
  ExtensionSlot: () => null,
}));

import { resolveDualAxis } from "@/pages/adhoc/sql-dashboard/dual-axis";
import type { SqlPanel } from "@/pages/adhoc/sql-dashboard/types";

import { SqlChart, seriesValueFormatter } from "./SqlChart";

const CHART_SIZE = { width: 640, height: 320 };

function panelWith(config: SqlPanel["config"]): SqlPanel {
  return {
    id: "signups-vs-rate",
    title: "Signups vs conversion",
    sql: "SELECT 1",
    source: "first-party",
    chartType: "line",
    width: 1,
    config,
  };
}

function yAxisCount(container: HTMLElement): number {
  return container.querySelectorAll(".recharts-yAxis").length;
}

/** Recharts renders tick labels outside the axis group, tagged by orientation. */
function axisTicks(container: HTMLElement, side: "left" | "right"): string[] {
  return [
    ...container.querySelectorAll(
      `.recharts-cartesian-axis-tick-value[orientation="${side}"]`,
    ),
  ].map((tick) => tick.textContent ?? "");
}

describe("SqlChart dual axis", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    // ResponsiveContainer measures its parent, which happy-dom reports as 0x0.
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

    mocks.rows = [
      { day: "2026-01-01", signups: 1000, conversion_rate: 0.1 },
      { day: "2026-01-02", signups: 2000, conversion_rate: 0.2 },
      { day: "2026-01-03", signups: 3000, conversion_rate: 0.4 },
    ];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("draws one axis by default", async () => {
    await act(async () => {
      root.render(
        <SqlChart
          panel={panelWith({
            xKey: "day",
            yKeys: ["signups", "conversion_rate"],
          })}
        />,
      );
    });

    expect(yAxisCount(container)).toBe(1);
    expect(axisTicks(container, "right")).toEqual([]);
  });

  it("draws a second axis with its own scale and formatter", async () => {
    await act(async () => {
      root.render(
        <SqlChart
          panel={panelWith({
            xKey: "day",
            yKeys: ["signups", "conversion_rate"],
            yFormatter: "number",
            rightYKeys: ["conversion_rate"],
            rightYFormatter: "percent",
          })}
        />,
      );
    });

    expect(yAxisCount(container)).toBe(2);
    expect(axisTicks(container, "left")).toContain("3,000");
    expect(axisTicks(container, "right")).toContain("40.00%");
    // Each axis names the series it carries.
    expect(container.textContent).toContain("signups");
    expect(container.textContent).toContain("conversion_rate");
  });
});

describe("seriesValueFormatter", () => {
  const yKeys = ['up{job="api"}', 'error_rate{job="api"}'];
  const displayName = (key: string) => key.split("{")[0];
  const plan = resolveDualAxis(
    yKeys,
    {
      yFormatter: "number",
      rightYKeys: ['error_rate{job="api"}'],
      rightYFormatter: "percent",
    },
    displayName,
  );

  it("formats each tooltip row with the formatter of its own axis", () => {
    const format = seriesValueFormatter(yKeys, plan, displayName, "number");

    expect(format(1200, "up")).toBe("1,200");
    expect(format(0.25, "error_rate")).toBe("25.00%");
    expect(format(0.25, 'error_rate{job="api"}')).toBe("25.00%");
  });

  it("falls back to the panel formatter for an unrecognized series", () => {
    const format = seriesValueFormatter(yKeys, plan, displayName, "number");

    expect(format(0.25, "unknown")).toBe("0.25");
    expect(format(0.25)).toBe("0.25");
  });
});
