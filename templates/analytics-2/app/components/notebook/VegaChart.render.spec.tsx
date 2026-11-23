// @vitest-environment jsdom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import * as vega from "vega";
import * as vl from "vega-lite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

import type { ChartDrawingProps, ChartPoint } from "./ChartDrawing";
import { buildVegaSpec } from "./vega-spec";
import { VegaChart, VegaSpecChart } from "./VegaChart";

vi.mock("./utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils")>();
  return {
    ...actual,
    formatCellValue: (value: unknown) => (value == null ? "" : String(value)),
  };
});

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  if (!("getBBox" in SVGElement.prototype)) {
    Object.defineProperty(SVGElement.prototype, "getBBox", {
      configurable: true,
      value() {
        return { x: 0, y: 0, width: 40, height: 12 };
      },
    });
  }
});

async function waitForSelector<T extends Element>(
  root: ParentNode,
  selector: string,
  timeoutMs = 5000,
): Promise<T> {
  return vi.waitFor(
    () => {
      const found = root.querySelector<T>(selector);
      if (!found) {
        throw new Error(
          `Timed out waiting for selector "${selector}". Host HTML: ${
            root instanceof HTMLElement ? root.innerHTML.slice(0, 500) : ""
          }`,
        );
      }
      return found;
    },
    { timeout: timeoutMs },
  );
}

async function mountVegaChart(
  props: ChartDrawingProps,
  wrapperStyle?: Partial<CSSStyleDeclaration>,
) {
  const container = document.createElement("div");
  if (wrapperStyle) {
    Object.assign(container.style, wrapperStyle);
  }
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <VegaChart {...props} />
      </AgentNativeI18nProvider>,
    );
  });
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VegaChart real SVG mark rendering", () => {
  it("renders bar marks with non-empty paths, distinct colors, positive width, and leaves host.style.color unpolluted", async () => {
    const { container, unmount } = await mountVegaChart({
      columns: ["month", "Revenue", "Cost"],
      rows: [
        ["Jan", 100, 40],
        ["Feb", 160, 70],
        ["Mar", 120, 50],
      ],
      mark: "bar",
    });
    try {
      const host = container.querySelector<HTMLElement>(".nb-vega-chart");
      expect(host).not.toBeNull();
      const svg = await waitForSelector<SVGSVGElement>(
        container,
        "svg g.mark-rect path",
      ).then(() => container.querySelector<SVGSVGElement>("svg")!);

      const widthAttr = Number(svg.getAttribute("width"));
      expect(widthAttr).toBeGreaterThan(0);

      const bars = [
        ...container.querySelectorAll<SVGPathElement>("g.mark-rect path"),
      ];
      expect(bars).toHaveLength(6);
      for (const bar of bars) {
        const d = bar.getAttribute("d") ?? "";
        expect(d.length).toBeGreaterThan(0);
      }

      const fills = new Set(bars.map((bar) => bar.getAttribute("fill")));
      expect(fills.size).toBe(2);
      for (const fill of fills) {
        expect(fill).toBeTruthy();
        expect(fill).not.toContain("var(");
      }

      expect(host!.style.color).toBe("");
    } finally {
      await unmount();
    }
  });

  it("renders line marks with non-empty path geometry", async () => {
    const { container, unmount } = await mountVegaChart({
      columns: ["month", "Revenue", "Cost"],
      rows: [
        ["Jan", 100, 40],
        ["Feb", 160, 70],
        ["Mar", 120, 50],
      ],
      mark: "line",
    });
    try {
      await waitForSelector(container, "svg g.mark-line path");
      const lines = [
        ...container.querySelectorAll<SVGPathElement>("g.mark-line path"),
      ];
      expect(lines.length).toBeGreaterThanOrEqual(2);
      for (const line of lines) {
        expect((line.getAttribute("d") ?? "").length).toBeGreaterThan(0);
      }
    } finally {
      await unmount();
    }
  });

  it("renders area marks with non-empty path geometry", async () => {
    const { container, unmount } = await mountVegaChart({
      columns: ["month", "Revenue", "Cost"],
      rows: [
        ["Jan", 100, 40],
        ["Feb", 160, 70],
        ["Mar", 120, 50],
      ],
      mark: "area",
    });
    try {
      await waitForSelector(container, "svg g.mark-area path");
      const areas = [
        ...container.querySelectorAll<SVGPathElement>("g.mark-area path"),
      ];
      expect(areas.length).toBeGreaterThanOrEqual(2);
      for (const area of areas) {
        expect((area.getAttribute("d") ?? "").length).toBeGreaterThan(0);
      }
    } finally {
      await unmount();
    }
  });

  it("renders scatter marks for each data point", async () => {
    const { container, unmount } = await mountVegaChart({
      columns: ["month", "Revenue"],
      rows: [
        ["Jan", 100],
        ["Feb", 160],
        ["Mar", 120],
      ],
      mark: "scatter",
    });
    try {
      await waitForSelector(container, "svg g.mark-symbol path");
      const points = [
        ...container.querySelectorAll<SVGPathElement>("g.mark-symbol path"),
      ];
      expect(points).toHaveLength(3);
      for (const point of points) {
        expect((point.getAttribute("d") ?? "").length).toBeGreaterThan(0);
      }
    } finally {
      await unmount();
    }
  });

  it("renders pie arcs for each slice with distinct fill colors", async () => {
    const { container, unmount } = await mountVegaChart({
      columns: ["region", "Sales"],
      rows: [
        ["North", 100],
        ["South", 60],
        ["West", 40],
      ],
      mark: "pie",
    });
    try {
      await waitForSelector(container, "svg g.mark-arc path");
      const arcs = [
        ...container.querySelectorAll<SVGPathElement>("g.mark-arc path"),
      ];
      expect(arcs).toHaveLength(3);
      const fills = new Set(arcs.map((arc) => arc.getAttribute("fill")));
      expect(fills.size).toBe(3);
      for (const arc of arcs) {
        expect((arc.getAttribute("d") ?? "").length).toBeGreaterThan(0);
      }
    } finally {
      await unmount();
    }
  });

  it("falls back to distinct Tableau 10 colors when --chart-1 is inherit and does not mutate host.style.color", async () => {
    const { container, unmount } = await mountVegaChart(
      {
        columns: ["month", "Revenue", "Cost"],
        rows: [
          ["Jan", 100, 40],
          ["Feb", 160, 70],
        ],
        mark: "bar",
      },
      { color: "rgb(17, 24, 39)" },
    );
    try {
      const host = container.querySelector<HTMLElement>(".nb-vega-chart")!;
      await waitForSelector(container, "svg g.mark-rect path");
      const bars = [
        ...container.querySelectorAll<SVGPathElement>("g.mark-rect path"),
      ];
      const fills = [...new Set(bars.map((bar) => bar.getAttribute("fill")))];
      expect(fills).toEqual(["#4c78a8", "#f58518"]);
      expect(host.style.color).toBe("");
    } finally {
      await unmount();
    }
  });

  it("does not pollute host.style.color when resolving explicit palette colors", async () => {
    const { container, unmount } = await mountVegaChart({
      columns: ["month", "Revenue", "Cost"],
      rows: [
        ["Jan", 100, 40],
        ["Feb", 160, 70],
      ],
      mark: "bar",
      colors: ["#e11d48", "#2563eb"],
    });
    try {
      const host = container.querySelector<HTMLElement>(".nb-vega-chart")!;
      await waitForSelector(container, "svg g.mark-rect path");
      expect(host.style.color).toBe("");
      const bars = [
        ...container.querySelectorAll<SVGPathElement>("g.mark-rect path"),
      ];
      const fills = [...new Set(bars.map((bar) => bar.getAttribute("fill")))];
      expect(fills).toEqual(["rgb(225, 29, 72)", "rgb(37, 99, 235)"]);
    } finally {
      await unmount();
    }
  });

  it("forwards original point with selectionId to onMarkSelect when a mark is clicked", async () => {
    const onMarkSelect = vi.fn();
    const points: Array<ChartPoint & { selectionId: string }> = [
      { rowIndex: 0, seriesIndex: 0, value: 125, selectionId: "mark-south" },
      { rowIndex: 0, seriesIndex: 1, value: 480, selectionId: "mark-north" },
    ];
    const { container, unmount } = await mountVegaChart({
      columns: ["month", "South", "North"],
      rows: [["Jan 2025"]],
      points,
      mark: "bar",
      onMarkSelect,
    });
    try {
      const bar = await waitForSelector<SVGPathElement>(
        container,
        "svg g.mark-rect path",
      );
      await act(async () => {
        bar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await vi.waitFor(() => {
        expect(onMarkSelect).toHaveBeenCalledTimes(1);
      });
      const [selectedPoint, targetSvg] = onMarkSelect.mock.calls[0] as [
        ChartPoint & { selectionId?: string },
        SVGElement,
      ];
      expect(selectedPoint.selectionId).toBe("mark-south");
      expect(selectedPoint).toEqual(points[0]);
      expect(targetSvg.tagName.toLowerCase()).toBe("svg");
    } finally {
      await unmount();
    }
  });

  it("calls onMarkClick with raw x and series when onMarkSelect is absent", async () => {
    const onMarkClick = vi.fn();
    const { container, unmount } = await mountVegaChart({
      columns: ["month", "Revenue", "Cost"],
      rows: [
        ["Jan", 100, 40],
        ["Feb", 160, 70],
      ],
      mark: "bar",
      onMarkClick,
    });
    try {
      const bar = await waitForSelector<SVGPathElement>(
        container,
        "svg g.mark-rect path",
      );
      await act(async () => {
        bar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await vi.waitFor(() => {
        expect(onMarkClick).toHaveBeenCalledTimes(1);
      });
      expect(onMarkClick).toHaveBeenCalledWith({ x: "Jan", series: "Revenue" });
    } finally {
      await unmount();
    }
  });

  it("resizes the embedded SVG when ResizeObserver reports a new container width", async () => {
    let callback: ResizeObserverCallback | null = null;
    class FakeResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        callback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);

    const { container, unmount } = await mountVegaChart({
      columns: ["month", "Revenue"],
      rows: [
        ["Jan", 100],
        ["Feb", 160],
      ],
      mark: "bar",
    });
    try {
      const host = container.querySelector<HTMLElement>(".nb-vega-chart")!;
      const svg = await waitForSelector<SVGSVGElement>(
        container,
        "svg g.mark-rect path",
      ).then(() => container.querySelector<SVGSVGElement>("svg")!);
      expect(Number(svg.getAttribute("width"))).toBe(480);

      await act(async () => {
        callback?.(
          [
            {
              target: host,
              contentRect: { width: 640, height: 260 } as DOMRectReadOnly,
            } as unknown as ResizeObserverEntry,
          ],
          {} as ResizeObserver,
        );
      });
      await vi.waitFor(() => {
        expect(Number(svg.getAttribute("width"))).toBe(640);
      });
    } finally {
      await unmount();
    }
  });

  it("compiles legendToggle signal for multi-series bar and pie specs when legend is enabled", async () => {
    const palette = ["#4c78a8", "#f58518", "#e45756"];
    for (const mark of ["bar", "pie"] as const) {
      const vlSpec = buildVegaSpec({
        columns: ["month", "Revenue", "Cost"],
        rows: [
          ["Jan", 10, 4],
          ["Feb", 20, 8],
        ],
        mark,
        palette,
        formatCategory: (v) => String(v),
        formatValue: (v) => String(v),
      });
      const compiled = vl.compile(vlSpec as never).spec;
      const signalNames = (compiled.signals ?? []).map((s) => s.name);
      expect(signalNames).toContain("legendToggle");
      expect(signalNames).toContain("pick");

      const view = new vega.View(vega.parse(compiled), { renderer: "none" });
      await view.runAsync();
      const svg = await view.toSVG();
      expect(svg).toContain(mark === "pie" ? "mark-arc" : "mark-rect");
    }
  });

  it("preserves stable Tableau colorIndices for encoded charts and renders VegaSpecChart with real SVG marks", async () => {
    const { container, unmount } = await mountVegaChart({
      columns: ["CREATED_DATE", "South", "North"],
      rows: [[Date.parse("2025-01-01")]],
      points: [
        { rowIndex: 0, seriesIndex: 0, value: 125 },
        { rowIndex: 0, seriesIndex: 1, value: 480 },
      ],
      encoding: {
        timeUnit: "month",
        aggregation: "sum",
        colorField: "Region",
        measures: [
          { field: "ARR", colorValue: "South" },
          { field: "ARR", colorValue: "North" },
        ],
        colorIndices: [1, 0],
        countRecords: false,
      },
      mark: "bar",
      stacked: true,
    });
    try {
      await waitForSelector(container, "svg g.mark-rect path");
      const bars = [
        ...container.querySelectorAll<SVGPathElement>("g.mark-rect path"),
      ];
      expect(bars).toHaveLength(2);
      expect(bars.map((bar) => bar.getAttribute("fill"))).toEqual([
        "#f58518",
        "#4c78a8",
      ]);
    } finally {
      await unmount();
    }

    const specContainer = document.createElement("div");
    document.body.appendChild(specContainer);
    const specRoot = createRoot(specContainer);
    try {
      await act(async () => {
        specRoot.render(
          <VegaSpecChart
            spec={{
              data: {
                values: [
                  { a: "A", b: 28 },
                  { a: "B", b: 55 },
                ],
              },
              mark: "bar",
              encoding: {
                x: { field: "a", type: "nominal" },
                y: { field: "b", type: "quantitative" },
              },
            }}
          />,
        );
      });
      await waitForSelector(specContainer, "svg g.mark-rect path");
      const svg = specContainer.querySelector<SVGSVGElement>("svg")!;
      expect(Number(svg.getAttribute("width"))).toBeGreaterThan(0);
      expect(
        specContainer.querySelectorAll("svg g.mark-rect path"),
      ).toHaveLength(2);
    } finally {
      await act(async () => specRoot.unmount());
      specContainer.remove();
    }
  });

  it("renders horizontal grouped, stacked, and 100% stacked bar charts with real SVG marks", async () => {
    for (const stackMode of ["grouped", "stacked", "normalize"] as const) {
      const { container, unmount } = await mountVegaChart({
        columns: ["month", "Revenue", "Cost"],
        rows: [
          ["Jan", 100, 40],
          ["Feb", 160, 70],
          ["Mar", 120, 50],
        ],
        mark: "bar",
        orientation: "horizontal",
        stackMode,
      });
      try {
        await waitForSelector(container, "svg g.mark-rect path");
        const bars = [
          ...container.querySelectorAll<SVGPathElement>("g.mark-rect path"),
        ];
        expect(bars).toHaveLength(6);
        for (const bar of bars) {
          expect((bar.getAttribute("d") ?? "").length).toBeGreaterThan(0);
        }
        if (stackMode === "normalize") {
          const axisTexts = [
            ...container.querySelectorAll("g.role-axis-label text"),
          ].map((el) => el.textContent ?? "");
          expect(axisTexts.some((t) => t.includes("%"))).toBe(true);
        }
      } finally {
        await unmount();
      }
    }
  });

  it("renders 100% stacked column and 100% stacked area charts with percent axes", async () => {
    const col = await mountVegaChart({
      columns: ["month", "Revenue", "Cost"],
      rows: [
        ["Jan", 100, 40],
        ["Feb", 160, 80],
      ],
      mark: "bar",
      stackMode: "normalize",
    });
    try {
      await waitForSelector(col.container, "svg g.mark-rect path");
      const bars = [
        ...col.container.querySelectorAll<SVGPathElement>("g.mark-rect path"),
      ];
      expect(bars).toHaveLength(4);
      const axisTexts = [
        ...col.container.querySelectorAll("g.role-axis-label text"),
      ].map((el) => el.textContent ?? "");
      expect(axisTexts.some((t) => t.includes("%"))).toBe(true);
    } finally {
      await col.unmount();
    }

    const area = await mountVegaChart({
      columns: ["month", "Revenue", "Cost"],
      rows: [
        ["Jan", 100, 40],
        ["Feb", 160, 80],
        ["Mar", 120, 60],
      ],
      mark: "area",
      stackMode: "normalize",
    });
    try {
      await waitForSelector(area.container, "svg g.mark-area path");
      const areas = [
        ...area.container.querySelectorAll<SVGPathElement>("g.mark-area path"),
      ];
      expect(areas.length).toBeGreaterThanOrEqual(2);
      const axisTexts = [
        ...area.container.querySelectorAll("g.role-axis-label text"),
      ].map((el) => el.textContent ?? "");
      expect(axisTexts.some((t) => t.includes("%"))).toBe(true);
    } finally {
      await area.unmount();
    }
  });

  it("renders single-column and binned histograms and fires click callbacks", async () => {
    const onMarkClick = vi.fn();
    const single = await mountVegaChart({
      columns: ["latency_ms"],
      rows: [[10], [15], [22], [25], [31], [44], [52]],
      mark: "histogram",
      onMarkClick,
    });
    try {
      const bar = await waitForSelector<SVGPathElement>(
        single.container,
        "svg g.mark-rect path",
      );
      const bars = [
        ...single.container.querySelectorAll<SVGPathElement>(
          "g.mark-rect path",
        ),
      ];
      expect(bars.length).toBeGreaterThan(0);
      for (const b of bars) {
        expect((b.getAttribute("d") ?? "").length).toBeGreaterThan(0);
      }
      await act(async () => {
        bar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await vi.waitFor(() => {
        expect(onMarkClick).toHaveBeenCalledTimes(1);
      });
    } finally {
      await single.unmount();
    }

    const binned = await mountVegaChart({
      columns: ["id", "score"],
      rows: [
        ["a", 10],
        ["b", 22],
        ["c", 35],
        ["d", 48],
        ["e", 60],
      ],
      mark: "histogram",
      binCount: 4,
    });
    try {
      await waitForSelector(binned.container, "svg g.mark-rect path");
      const bars = [
        ...binned.container.querySelectorAll<SVGPathElement>(
          "g.mark-rect path",
        ),
      ];
      expect(bars.length).toBeGreaterThan(0);
    } finally {
      await binned.unmount();
    }
  });

  it("renders dual-axis and multi-series combo charts without duplicate signals and handles mark clicks", async () => {
    const onMarkSelect = vi.fn();
    const points: Array<ChartPoint & { selectionId: string }> = [
      { rowIndex: 0, seriesIndex: 0, value: 100, selectionId: "rev-jan" },
      { rowIndex: 0, seriesIndex: 1, value: 22, selectionId: "margin-jan" },
      { rowIndex: 1, seriesIndex: 0, value: 160, selectionId: "rev-feb" },
      { rowIndex: 1, seriesIndex: 1, value: 28, selectionId: "margin-feb" },
    ];
    const dual = await mountVegaChart({
      columns: ["month", "Revenue", "Margin"],
      rows: [
        ["Jan", 100, 22],
        ["Feb", 160, 28],
      ],
      points,
      mark: "combo",
      onMarkSelect,
    });
    try {
      await waitForSelector(dual.container, "svg g.mark-rect path");
      await waitForSelector(dual.container, "svg g.mark-line path");
      const bars = [
        ...dual.container.querySelectorAll<SVGPathElement>("g.mark-rect path"),
      ];
      const lines = [
        ...dual.container.querySelectorAll<SVGPathElement>("g.mark-line path"),
      ];
      expect(bars).toHaveLength(2);
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const axisTitles = [
        ...dual.container.querySelectorAll("g.role-axis-title text"),
      ].map((el) => el.textContent ?? "");
      expect(axisTitles).toContain("Revenue");
      expect(axisTitles).toContain("Margin");

      await act(async () => {
        bars[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await vi.waitFor(() => {
        expect(onMarkSelect).toHaveBeenCalledTimes(1);
      });
      expect(
        (
          onMarkSelect.mock.calls[0]![0] as ChartPoint & {
            selectionId?: string;
          }
        ).selectionId,
      ).toBe("rev-jan");

      const linePoint = await waitForSelector<SVGPathElement>(
        dual.container,
        "svg g.mark-symbol path",
      );
      await act(async () => {
        linePoint.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await vi.waitFor(() => {
        expect(onMarkSelect).toHaveBeenCalledTimes(2);
      });
      expect(
        (
          onMarkSelect.mock.calls[1]![0] as ChartPoint & {
            selectionId?: string;
          }
        ).selectionId,
      ).toBe("margin-jan");
    } finally {
      await dual.unmount();
    }

    const multi = await mountVegaChart({
      columns: ["month", "Revenue", "Cost", "Profit"],
      rows: [
        ["Jan", 100, 40, 60],
        ["Feb", 160, 70, 90],
      ],
      mark: "combo",
    });
    try {
      await waitForSelector(multi.container, "svg g.mark-rect path");
      await waitForSelector(multi.container, "svg g.mark-line path");
      expect(
        multi.container.querySelectorAll("g.mark-line path").length,
      ).toBeGreaterThanOrEqual(2);
    } finally {
      await multi.unmount();
    }
  });

  it("renders heatmap cells with quantitative blue fills and fires click-to-filter", async () => {
    const onMarkClick = vi.fn();
    const { container, unmount } = await mountVegaChart({
      columns: ["day", "Morning", "Evening"],
      rows: [
        ["Mon", 10, 80],
        ["Tue", 40, 20],
      ],
      mark: "heatmap",
      onMarkClick,
    });
    try {
      const cell = await waitForSelector<SVGPathElement>(
        container,
        "svg g.mark-rect.role-mark path",
      );
      const cells = [
        ...container.querySelectorAll<SVGPathElement>(
          "g.mark-rect.role-mark path",
        ),
      ];
      expect(cells).toHaveLength(4);
      const fills = new Set(cells.map((c) => c.getAttribute("fill")));
      expect(fills.size).toBeGreaterThan(1);

      await act(async () => {
        cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await vi.waitFor(() => {
        expect(onMarkClick).toHaveBeenCalledTimes(1);
      });
      expect(onMarkClick).toHaveBeenCalledWith({ x: "Mon", series: "Morning" });
    } finally {
      await unmount();
    }
  });

  it("renders temporal and numeric gantt charts and fires click callbacks", async () => {
    const onMarkClick = vi.fn();
    const temporal = await mountVegaChart({
      columns: ["Task", "Start", "End", "Phase"],
      rows: [
        ["Design", "2025-01-01", "2025-01-10", "Discovery"],
        ["Build", "2025-01-08", "2025-01-25", "Delivery"],
      ],
      mark: "gantt",
      onMarkClick,
    });
    try {
      const bar = await waitForSelector<SVGPathElement>(
        temporal.container,
        "svg g.mark-rect path",
      );
      const bars = [
        ...temporal.container.querySelectorAll<SVGPathElement>(
          "g.mark-rect path",
        ),
      ];
      expect(bars).toHaveLength(2);
      for (const b of bars) {
        expect((b.getAttribute("d") ?? "").length).toBeGreaterThan(0);
      }
      await act(async () => {
        bar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await vi.waitFor(() => {
        expect(onMarkClick).toHaveBeenCalledTimes(1);
      });
      expect(onMarkClick).toHaveBeenCalledWith({
        x: "Design",
        series: "Discovery",
      });
    } finally {
      await temporal.unmount();
    }

    const numeric = await mountVegaChart({
      columns: ["Task", "Start", "End"],
      rows: [
        ["Step 1", 0, 5],
        ["Step 2", 4, 12],
      ],
      mark: "gantt",
    });
    try {
      await waitForSelector(numeric.container, "svg g.mark-rect path");
      expect(
        numeric.container.querySelectorAll("g.mark-rect path"),
      ).toHaveLength(2);
    } finally {
      await numeric.unmount();
    }
  });

  it("compiles all chart types with zero Vega-Lite warnings and toggles legendToggle opacity in a real Vega view", async () => {
    const palette = ["#4c78a8", "#f58518", "#e45756"];
    const cases: Array<{
      name: string;
      legendSignal?: string;
      legendValue?: string;
      input: Parameters<typeof buildVegaSpec>[0];
    }> = [
      {
        name: "bar",
        legendSignal: "legendToggle_series_legend",
        legendValue: "Revenue",
        input: {
          columns: ["month", "Revenue", "Cost"],
          rows: [
            ["Jan", 10, 4],
            ["Feb", 20, 8],
          ],
          mark: "bar",
          palette,
          formatCategory: (v) => String(v),
          formatValue: (v) => String(v),
        },
      },
      {
        name: "horizontal-bar",
        legendSignal: "legendToggle_series_legend",
        legendValue: "Revenue",
        input: {
          columns: ["month", "Revenue", "Cost"],
          rows: [
            ["Jan", 10, 4],
            ["Feb", 20, 8],
          ],
          mark: "bar",
          orientation: "horizontal",
          palette,
          formatCategory: (v) => String(v),
          formatValue: (v) => String(v),
        },
      },
      {
        name: "normalize-column",
        legendSignal: "legendToggle_series_legend",
        legendValue: "Revenue",
        input: {
          columns: ["month", "Revenue", "Cost"],
          rows: [
            ["Jan", 10, 4],
            ["Feb", 20, 8],
          ],
          mark: "bar",
          stackMode: "normalize",
          palette,
          formatCategory: (v) => String(v),
          formatValue: (v) => String(v),
        },
      },
      {
        name: "normalize-area",
        legendSignal: "legendToggle_series_legend",
        legendValue: "Revenue",
        input: {
          columns: ["month", "Revenue", "Cost"],
          rows: [
            ["Jan", 10, 4],
            ["Feb", 20, 8],
          ],
          mark: "area",
          stackMode: "normalize",
          palette,
          formatCategory: (v) => String(v),
          formatValue: (v) => String(v),
        },
      },
      {
        name: "line",
        legendSignal: "legendToggle_series_legend",
        legendValue: "Revenue",
        input: {
          columns: ["month", "Revenue", "Cost"],
          rows: [
            ["Jan", 10, 4],
            ["Feb", 20, 8],
          ],
          mark: "line",
          palette,
          formatCategory: (v) => String(v),
          formatValue: (v) => String(v),
        },
      },
      {
        name: "scatter",
        legendSignal: "legendToggle_series_legend",
        legendValue: "Revenue",
        input: {
          columns: ["month", "Revenue", "Cost"],
          rows: [
            ["Jan", 10, 4],
            ["Feb", 20, 8],
          ],
          mark: "scatter",
          palette,
          formatCategory: (v) => String(v),
          formatValue: (v) => String(v),
        },
      },
      {
        name: "pie",
        legendSignal: "legendToggle_x_legend",
        legendValue: "Jan",
        input: {
          columns: ["month", "Revenue"],
          rows: [
            ["Jan", 10],
            ["Feb", 20],
          ],
          mark: "pie",
          palette,
          formatCategory: (v) => String(v),
          formatValue: (v) => String(v),
        },
      },
      {
        name: "combo",
        legendSignal: "legendToggle_series_legend",
        legendValue: "Revenue",
        input: {
          columns: ["month", "Revenue", "Cost"],
          rows: [
            ["Jan", 10, 4],
            ["Feb", 20, 8],
          ],
          mark: "combo",
          palette,
          formatCategory: (v) => String(v),
          formatValue: (v) => String(v),
        },
      },
      {
        name: "gantt",
        legendSignal: "legendToggle_series_legend",
        legendValue: "Discovery",
        input: {
          columns: ["Task", "Start", "End", "Phase"],
          rows: [
            ["Design", "2025-01-01", "2025-01-10", "Discovery"],
            ["Build", "2025-01-08", "2025-01-25", "Delivery"],
          ],
          mark: "gantt",
          palette,
          formatCategory: (v) => String(v),
          formatValue: (v) => String(v),
        },
      },
      {
        name: "histogram",
        input: {
          columns: ["latency_ms"],
          rows: [[10], [20], [30], [40]],
          mark: "histogram",
          binCount: 4,
          palette,
          formatCategory: (v) => String(v),
          formatValue: (v) => String(v),
        },
      },
      {
        name: "heatmap",
        input: {
          columns: ["day", "Morning", "Evening"],
          rows: [
            ["Mon", 10, 80],
            ["Tue", 40, 20],
          ],
          mark: "heatmap",
          palette,
          formatCategory: (v) => String(v),
          formatValue: (v) => String(v),
        },
      },
    ];

    for (const testCase of cases) {
      const warnings: string[] = [];
      const logger = {
        level: () => logger,
        warn: (...args: unknown[]) => {
          warnings.push(args.map(String).join(" "));
          return logger;
        },
        info: () => logger,
        debug: () => logger,
        error: (...args: unknown[]) => {
          warnings.push(`ERR:${args.map(String).join(" ")}`);
          return logger;
        },
      };
      const vlSpec = buildVegaSpec(testCase.input);
      const compiled = vl.compile(vlSpec as never, {
        logger: logger as never,
      }).spec;
      expect(warnings, testCase.name).toEqual([]);
      const signalNames = (compiled.signals ?? []).map((s) => s.name);
      expect(signalNames, testCase.name).toContain("pick");
      expect(new Set(signalNames).size, testCase.name).toBe(signalNames.length);

      const view = new vega.View(vega.parse(compiled), { renderer: "none" });
      await view.runAsync();
      if (testCase.legendSignal && testCase.legendValue) {
        expect(signalNames, testCase.name).toContain("legendToggle");
        view.signal(testCase.legendSignal, testCase.legendValue);
        await view.runAsync();
        const svg = await view.toSVG();
        expect(svg, testCase.name).toContain('opacity="0.2"');
        expect(svg, testCase.name).toContain('opacity="1"');
      }
    }
  });
});
