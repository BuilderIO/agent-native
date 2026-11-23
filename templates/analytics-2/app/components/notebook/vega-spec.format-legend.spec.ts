import { describe, expect, it } from "vitest";

import { buildVegaSpec, type VegaChartInput } from "./vega-spec";

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

function allAxes(spec: Record<string, any>) {
  const layers: Array<Record<string, any>> = spec.layer ?? [spec];
  return layers.flatMap((layer) =>
    Object.entries(layer.encoding ?? {}).flatMap(([channel, definition]) =>
      (definition as Record<string, any>).type === "quantitative" &&
      (channel === "x" || channel === "y")
        ? [(definition as Record<string, any>).axis]
        : [],
    ),
  );
}

describe("percent value format on axes", () => {
  it.each(["bar", "line", "area", "combo"] as const)(
    "labels %s value ticks with a percent sign",
    (mark) => {
      const axes = allAxes(
        buildVegaSpec({ ...base, mark, valueFormat: "percent" }),
      );
      expect(axes.length).toBeGreaterThan(0);
      for (const axis of axes) expect(axis.labelExpr).toContain("'%'");
    },
  );

  it("labels horizontal bar value ticks too", () => {
    const axes = allAxes(
      buildVegaSpec({
        ...base,
        orientation: "horizontal",
        valueFormat: "percent",
      }),
    );
    expect(axes[0].labelExpr).toContain("'%'");
  });

  it("leaves ticks alone for the number format", () => {
    for (const valueFormat of ["number", undefined] as const) {
      for (const axis of allAxes(buildVegaSpec({ ...base, valueFormat })))
        expect(axis.labelExpr).toBeUndefined();
    }
  });

  it("scales fractions to percent only when no value exceeds one", () => {
    const fractions = allAxes(
      buildVegaSpec({
        ...base,
        rows: [
          ["Jan", 0.25, 0.5],
          ["Feb", 0.75, 1],
        ],
        valueFormat: "percent",
      }),
    );
    expect(fractions[0].labelExpr).toContain("datum.value * 100");
    const wholes = allAxes(buildVegaSpec({ ...base, valueFormat: "percent" }));
    expect(wholes[0].labelExpr).not.toContain("* 100");
  });
});

describe("chart title", () => {
  it("is limited to the chart width so a long title cannot push the plot out of view", () => {
    const spec = buildVegaSpec({ ...base, title: "x".repeat(300) });
    expect(spec.title).toEqual({
      text: "x".repeat(300),
      limit: { expr: "width" },
    });
  });

  it("is absent when empty", () => {
    expect(buildVegaSpec({ ...base, title: null }).title).toBeUndefined();
  });
});

describe("legend titles", () => {
  const legendOf = (spec: Record<string, any>) => {
    const layers: Array<Record<string, any>> = spec.layer ?? [spec];
    return layers.flatMap((layer) => layer.encoding?.color?.legend ?? [])[0];
  };

  it("does not title a multi-series legend with the internal series field", () => {
    expect(legendOf(buildVegaSpec(base))).toMatchObject({ title: null });
  });

  it("titles a pie legend with its category column", () => {
    const legend = legendOf(
      buildVegaSpec({
        ...base,
        mark: "pie",
        columns: ["month", "Revenue"],
        rows: [
          ["Jan", 10],
          ["Feb", 12],
        ],
      }),
    );
    expect(legend).toMatchObject({ title: "month" });
  });

  it("drops the legend title on a grouped gantt", () => {
    const spec = buildVegaSpec({
      ...base,
      mark: "gantt",
      columns: ["task", "start", "end", "owner"],
      rows: [
        ["a", 1, 2, "x"],
        ["b", 2, 3, "y"],
      ],
    });
    const legend = legendOf(spec);
    if (legend) expect(legend.title).toBeNull();
  });
});
