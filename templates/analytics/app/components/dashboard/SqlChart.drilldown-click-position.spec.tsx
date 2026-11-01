// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/hooks", () => ({
  useDemoModeStatus: () => ({
    enabled: false,
    forced: false,
    isLoading: false,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({
    formatDate: String,
    formatList: (values: string[]) => values.join(", "),
    formatNumber: String,
  }),
}));

vi.mock("@/lib/sql-query", () => ({
  useSqlQuery: () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: null,
  }),
}));

vi.mock("@agent-native/toolkit/app/extensions", () => ({
  EmbeddedExtension: () => null,
  ExtensionSlot: () => null,
  isExtensionApiPath: () => false,
}));

import type { SqlPanel } from "@/pages/adhoc/sql-dashboard/types";

import { SqlChart, type ChartDatum } from "./SqlChart";

const CHART_SIZE = { width: 640, height: 320 };

const ROWS = ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"].map(
  (day, index) => ({ day, people: 100 + index * 10 }),
);

function panel(chartType: "line" | "area" | "combo"): SqlPanel {
  return {
    id: "people",
    title: "New people",
    sql: "SELECT day, people FROM weekly",
    source: "first-party",
    chartType,
    width: 1,
    config: {
      xKey: "day",
      yKeys: ["people"],
      barKeys: chartType === "combo" ? ["people"] : [],
    },
  };
}

describe("SqlChart drill-down click position", () => {
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

  async function renderChart(
    chartType: "line" | "area" | "combo",
    rows: Record<string, unknown>[] = ROWS,
  ) {
    const onDatumClick = vi.fn<(datum: ChartDatum) => void>();
    await act(async () => {
      root.render(
        <SqlChart
          panel={panel(chartType)}
          onDatumClick={onDatumClick}
          resultOverride={{ rows }}
        />,
      );
    });
    return onDatumClick;
  }

  /** Recharts clips the series to the plot; its clip rect is the plot's box. */
  function plotArea() {
    const rect = container.querySelector("clipPath rect")!;
    const left = Number(rect.getAttribute("x"));
    const top = Number(rect.getAttribute("y"));
    return {
      left,
      top,
      width: Number(rect.getAttribute("width")),
      height: Number(rect.getAttribute("height")),
    };
  }

  /** A click with no mousemove first, so Recharts has no hovered point yet. */
  async function clickChartAt(clientX: number, clientY: number) {
    const wrapper = container.querySelector(".recharts-wrapper")!;
    await act(async () => {
      wrapper.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX, clientY }),
      );
    });
  }

  it.each(["line", "area"] as const)(
    "opens the %s chart point under a click that lands before any hover",
    async (chartType) => {
      const onDatumClick = await renderChart(chartType);
      const plot = plotArea();
      const step = plot.width / (ROWS.length - 1);

      await clickChartAt(plot.left + step * 2 + step / 4, plot.top + 10);

      expect(onDatumClick).toHaveBeenCalledTimes(1);
      expect(onDatumClick).toHaveBeenCalledWith({
        x: "2026-10-12",
        series: undefined,
        value: undefined,
      });
    },
  );

  it("opens the combo chart column under a click above its bar", async () => {
    const onDatumClick = await renderChart("combo");
    const plot = plotArea();
    const band = plot.width / ROWS.length;

    await clickChartAt(plot.left + band * 3.5, plot.top + 2);

    expect(onDatumClick).toHaveBeenCalledTimes(1);
    expect(onDatumClick).toHaveBeenCalledWith({
      x: "2026-10-19",
      series: undefined,
      value: undefined,
    });
  });

  it("opens the row drawn under the click when a null x shifts the axis", async () => {
    // Recharts leaves null x values off the axis and draws row i at the i-th
    // tick, so the point drawn at the last tick is the 2026-09-28 row.
    const onDatumClick = await renderChart("line", [
      { day: null, people: 90 },
      { day: "2026-09-28", people: 100 },
      { day: "2026-10-05", people: 110 },
    ]);
    const plot = plotArea();

    await clickChartAt(plot.left + plot.width - 4, plot.top + 10);

    expect(onDatumClick).toHaveBeenCalledWith({
      x: "2026-09-28",
      series: undefined,
      value: undefined,
    });
  });

  it("opens the clicked row when x values repeat", async () => {
    const onDatumClick = await renderChart(
      "line",
      ["Mon", "Tue", "Wed", "Mon"].map((day, index) => ({
        day,
        people: 100 + index,
      })),
    );
    const plot = plotArea();
    const step = plot.width / 3;

    await clickChartAt(plot.left + step * 2 + step / 4, plot.top + 10);

    expect(onDatumClick).toHaveBeenCalledWith({
      x: "Wed",
      series: undefined,
      value: undefined,
    });
  });

  it("opens nothing for a click outside the plot", async () => {
    const onDatumClick = await renderChart("line");
    const plot = plotArea();

    await clickChartAt(plot.left / 2, plot.top + plot.height / 2);
    await clickChartAt(plot.left + plot.width / 2, plot.top + plot.height + 4);

    expect(onDatumClick).not.toHaveBeenCalled();
  });
});
