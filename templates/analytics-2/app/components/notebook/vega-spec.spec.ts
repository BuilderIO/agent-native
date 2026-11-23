import { describe, expect, it } from "vitest";

import { buildVegaSpec, isVegaMark, type VegaChartInput } from "./vega-spec";

const base: VegaChartInput = {
  columns: ["month", "Revenue", "Cost"],
  rows: [
    ["Jan", 10, 4],
    ["Feb", 12, 6],
  ],
  mark: "bar",
  palette: ["#111", "#222"],
  formatCategory: (value) => String(value),
  formatValue: (value) => `${value}!`,
};

function layers(spec: Record<string, unknown>) {
  return (spec.layer as Array<Record<string, unknown>> | undefined) ?? [spec];
}

describe("buildVegaSpec", () => {
  it("turns wide rows into long series data", () => {
    const spec = buildVegaSpec(base);
    expect(spec.data).toEqual({
      values: [
        {
          x: "Jan",
          series: "Revenue",
          value: 10,
          label: "10!",
          rowIndex: 0,
          seriesIndex: 0,
        },
        {
          x: "Jan",
          series: "Cost",
          value: 4,
          label: "4!",
          rowIndex: 0,
          seriesIndex: 1,
        },
        {
          x: "Feb",
          series: "Revenue",
          value: 12,
          label: "12!",
          rowIndex: 1,
          seriesIndex: 0,
        },
        {
          x: "Feb",
          series: "Cost",
          value: 6,
          label: "6!",
          rowIndex: 1,
          seriesIndex: 1,
        },
      ],
    });
  });

  it("draws grouped columns unless stacked", () => {
    const grouped = layers(buildVegaSpec(base))[0] as Record<string, any>;
    expect(grouped.mark.type).toBe("bar");
    expect(grouped.encoding.xOffset.field).toBe("series");
    const stacked = layers(
      buildVegaSpec({ ...base, stacked: true }),
    )[0] as Record<string, any>;
    expect(stacked.encoding.xOffset).toBeUndefined();
  });

  it("maps each chart type to a Vega-Lite mark", () => {
    const type = (mark: VegaChartInput["mark"]) =>
      (layers(buildVegaSpec({ ...base, mark }))[0] as Record<string, any>).mark
        .type;
    expect(type("line")).toBe("line");
    expect(type("area")).toBe("area");
    expect(type("scatter")).toBe("point");
    expect(type("pie")).toBe("arc");
  });

  it("adds click selection, legend toggle and tooltips", () => {
    const spec = buildVegaSpec(base);
    const names = JSON.stringify(
      spec.params ?? layers(spec).flatMap((l) => l.params ?? []),
    );
    expect(names).toContain('"name":"pick"');
    expect(names).toContain('"bind":"legend"');
    expect(JSON.stringify(spec)).toContain('"tooltip"');
  });

  it("omits the legend when disabled", () => {
    expect(
      JSON.stringify(buildVegaSpec({ ...base, legend: false })),
    ).not.toContain('"bind":"legend"');
  });

  it("identifies all Vega-Lite marks via isVegaMark", () => {
    for (const mark of [
      "bar",
      "line",
      "area",
      "scatter",
      "pie",
      "histogram",
      "combo",
      "heatmap",
      "gantt",
    ] as const) {
      expect(isVegaMark(mark)).toBe(true);
    }
    expect(isVegaMark("sankey")).toBe(false);
    expect(isVegaMark("funnel")).toBe(false);
  });

  it("builds grouped, stacked, and 100% normalized horizontal bar specs", () => {
    const grouped = buildVegaSpec({
      ...base,
      orientation: "horizontal",
    });
    expect(grouped.encoding.y.field).toBe("x");
    expect(grouped.encoding.y.sort).toEqual(["Jan", "Feb"]);
    expect(grouped.encoding.x.field).toBe("value");
    expect(grouped.encoding.x.stack).toBeNull();
    expect(grouped.encoding.yOffset.field).toBe("series");

    const stacked = buildVegaSpec({
      ...base,
      orientation: "horizontal",
      stackMode: "stacked",
    });
    expect(stacked.encoding.x.stack).toBe("zero");
    expect(stacked.encoding.yOffset).toBeUndefined();

    const normalized = buildVegaSpec({
      ...base,
      orientation: "horizontal",
      stackMode: "normalize",
    });
    expect(normalized.encoding.x.stack).toBe("normalize");
    expect(normalized.encoding.x.axis.format).toBe("%");
    expect(normalized.encoding.yOffset).toBeUndefined();
    expect(normalized.data.values[0].pctLabel).toMatch(/%$/);
    expect(JSON.stringify(normalized.encoding.tooltip)).toContain("pctLabel");
  });

  it("builds 100% stacked column and 100% stacked area specs with share tooltips", () => {
    const col = buildVegaSpec({
      ...base,
      mark: "bar",
      stackMode: "normalize",
    });
    expect(col.encoding.y.stack).toBe("normalize");
    expect(col.encoding.y.axis.format).toBe("%");
    expect(col.encoding.xOffset).toBeUndefined();
    expect(col.data.values[0].pctLabel).toMatch(/%$/);
    expect(JSON.stringify(col.encoding.tooltip)).toContain("pctLabel");

    const area = buildVegaSpec({
      ...base,
      mark: "area",
      stackMode: "normalize",
    });
    expect(area.encoding.y.stack).toBe("normalize");
    expect(area.encoding.y.axis.format).toBe("%");
    expect(area.data.values[0].pctLabel).toMatch(/%$/);
    expect(JSON.stringify(area.encoding.tooltip)).toContain("pctLabel");
  });

  it("builds histogram specs for single-column and two-column inputs with optional binCount", () => {
    const singleCol = buildVegaSpec({
      ...base,
      columns: ["latency_ms"],
      rows: [[12], [18], [24], [30], [45]],
      mark: "histogram",
    });
    expect(singleCol.mark.type).toBe("bar");
    expect(singleCol.encoding.x.field).toBe("rawX");
    expect(singleCol.encoding.x.bin).toBe(true);
    expect(singleCol.encoding.y.aggregate).toBe("count");
    expect(singleCol.data.values).toHaveLength(5);
    expect(JSON.stringify(singleCol.params)).toContain('"name":"pick"');

    const withBins = buildVegaSpec({
      ...base,
      columns: ["id", "score"],
      rows: [
        ["a", 10],
        ["b", 20],
        ["c", 35],
        ["d", 50],
      ],
      mark: "histogram",
      binCount: 8,
    });
    expect(withBins.encoding.x.bin).toEqual({ maxbins: 8 });
    expect(withBins.data.values.map((v: { rawX: number }) => v.rawX)).toEqual([
      10, 20, 35, 50,
    ]);
  });

  it("builds layered combo specs with dual axis for 2 series and shared axis for 3+ series", () => {
    const dual = buildVegaSpec({
      ...base,
      mark: "combo",
    });
    expect(dual.layer).toHaveLength(2);
    expect(dual.layer[0].mark.type).toBe("bar");
    expect(dual.layer[1].mark.type).toBe("line");
    expect(dual.resolve.scale.y).toBe("independent");
    expect(dual.layer[0].encoding.y.axis.orient).toBe("left");
    expect(dual.layer[1].encoding.y.axis.orient).toBe("right");
    const dualParams = JSON.stringify(
      dual.params ?? layers(dual).flatMap((l) => l.params ?? []),
    );
    expect(dualParams).toContain('"name":"pick"');
    expect(dualParams).toContain('"bind":"legend"');

    const multi = buildVegaSpec({
      ...base,
      columns: ["month", "Revenue", "Cost", "Profit"],
      rows: [
        ["Jan", 10, 4, 6],
        ["Feb", 12, 6, 6],
      ],
      mark: "combo",
    });
    expect(multi.layer).toHaveLength(2);
    expect(multi.resolve?.scale?.y).toBeUndefined();
  });

  it("builds heatmap specs with rect mark and quantitative color scale", () => {
    const spec = buildVegaSpec({
      ...base,
      mark: "heatmap",
    });
    expect(spec.mark.type).toBe("rect");
    expect(spec.encoding.x.field).toBe("x");
    expect(spec.encoding.y.field).toBe("series");
    expect(spec.encoding.color.type).toBe("quantitative");
    expect(spec.encoding.color.scale.scheme).toBe("blues");
    expect(JSON.stringify(spec.encoding.tooltip)).toContain('"field":"series"');
    expect(JSON.stringify(spec.params)).toContain('"name":"pick"');
  });

  it("builds gantt specs with temporal and quantitative start/end ranges", () => {
    const temporal = buildVegaSpec({
      ...base,
      columns: ["Task", "Start", "End", "Phase"],
      rows: [
        ["Design", "2025-01-01", "2025-01-10", "Discovery"],
        ["Build", "2025-01-08", "2025-01-25", "Delivery"],
      ],
      mark: "gantt",
    });
    expect(temporal.mark.type).toBe("bar");
    expect(temporal.encoding.y.field).toBe("x");
    expect(temporal.encoding.x.field).toBe("start");
    expect(temporal.encoding.x.type).toBe("temporal");
    expect(temporal.encoding.x2.field).toBe("end");
    expect(JSON.stringify(temporal.params)).toContain('"name":"pick"');
    expect(JSON.stringify(temporal.params)).toContain('"bind":"legend"');

    const numeric = buildVegaSpec({
      ...base,
      columns: ["Task", "Start", "End"],
      rows: [
        ["Step 1", 0, 5],
        ["Step 2", 4, 12],
      ],
      mark: "gantt",
    });
    expect(numeric.encoding.x.type).toBe("quantitative");
    expect(numeric.encoding.x2.field).toBe("end");
  });

  it("enables axis label overlap removal and densifies sparse stacked area series with zeros", () => {
    const sparse = buildVegaSpec({
      ...base,
      columns: ["date", "alpha", "beta"],
      rows: [
        ["2026-08-21", 10, null],
        ["2026-08-22", null, 5],
        ["2026-08-23", 8, 4],
      ],
      points: [
        { rowIndex: 0, seriesIndex: 0, value: 10 },
        { rowIndex: 1, seriesIndex: 1, value: 5 },
        { rowIndex: 2, seriesIndex: 0, value: 8 },
        { rowIndex: 2, seriesIndex: 1, value: 4 },
      ],
      mark: "area",
      stacked: true,
    });
    expect(sparse.config.axis.labelOverlap).toBe(true);
    expect(sparse.encoding.x.axis.labelOverlap).toBe(true);
    expect(sparse.data.values).toHaveLength(6);
    expect(
      sparse.data.values.find(
        (d: { x: string; series: string }) =>
          d.x === "2026-08-21" && d.series === "beta",
      )?.value,
    ).toBe(0);
    expect(
      sparse.data.values.find(
        (d: { x: string; series: string }) =>
          d.x === "2026-08-22" && d.series === "alpha",
      )?.value,
    ).toBe(0);

    const normalized = buildVegaSpec({
      ...base,
      columns: ["date", "alpha", "beta"],
      rows: [
        ["2026-08-21", 10, null],
        ["2026-08-22", null, 5],
      ],
      points: [
        { rowIndex: 0, seriesIndex: 0, value: 10 },
        { rowIndex: 1, seriesIndex: 1, value: 5 },
      ],
      mark: "area",
      stackMode: "normalize",
    });
    expect(normalized.data.values).toHaveLength(4);
    expect(
      normalized.data.values.find(
        (d: { x: string; series: string }) =>
          d.x === "2026-08-21" && d.series === "beta",
      ),
    ).toMatchObject({ value: 0, pctLabel: "0%" });
  });

  it("densifies absent series with zeros for multi-series bar and line pivot charts", () => {
    for (const mark of ["bar", "line"] as const) {
      const spec = buildVegaSpec({
        ...base,
        columns: ["date", "alpha", "beta"],
        rows: [
          ["2026-08-21", 10, null],
          ["2026-08-22", null, 5],
        ],
        points: [
          { rowIndex: 0, seriesIndex: 0, value: 10 },
          { rowIndex: 1, seriesIndex: 1, value: 5 },
        ],
        mark,
      });
      expect(spec.data.values).toHaveLength(4);
      expect(
        spec.data.values.find(
          (d: { x: string; series: string }) =>
            d.x === "2026-08-21" && d.series === "beta",
        )?.value,
      ).toBe(0);
      expect(
        spec.data.values.find(
          (d: { x: string; series: string }) =>
            d.x === "2026-08-22" && d.series === "alpha",
        )?.value,
      ).toBe(0);
    }
  });
});
