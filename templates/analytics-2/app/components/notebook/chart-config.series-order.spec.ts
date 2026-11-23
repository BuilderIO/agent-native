import { describe, expect, it } from "vitest";

import type { ChartSpec } from "@/lib/model/contracts";

import { chartSeriesFrom } from "./chart-config";
import type { ChartDataframe } from "./chart-config";
import {
  APP_SERIES_COLORS,
  DEFAULT_SERIES_COLORS,
  NON_APP_SERIES_COLORS,
  UNKNOWN_APP_COLOR,
} from "./chart-palette";

const dataframe: ChartDataframe = {
  name: "counts",
  cellId: "source",
  columns: [
    { name: "day", type: "string" },
    { name: "group", type: "string" },
    { name: "count", type: "number" },
  ],
  rows: [
    ["first", "Other", 50],
    ["first", "small", 2],
    ["first", "large", 5],
    ["second", "small", 1],
    ["second", "large", 6],
  ],
};

const spec: ChartSpec = {
  mark: "area",
  xField: "day",
  yField: "count",
  seriesField: "group",
  stacked: true,
  title: null,
};

describe("report A2-ASK84-STACKED-SERIES-ORDER", () => {
  it("places larger totals first and catch-all groups last", () => {
    const result = chartSeriesFrom(spec, dataframe);
    expect(result.columns).toEqual(["day", "large", "small", "Other"]);
    expect(result.rows).toEqual([
      ["first", 5, 2, 50],
      ["second", 6, 1, 0],
    ]);
  });

  it("keeps explicit groups first and ranks the remaining groups", () => {
    const result = chartSeriesFrom(
      { ...spec, seriesOrder: ["small"] },
      dataframe,
    );
    expect(result.columns).toEqual(["day", "small", "large", "Other"]);
  });

  it("keeps each series color when the stack order changes", () => {
    const result = chartSeriesFrom(
      { ...spec, colors: ["red", "green", "blue"] },
      dataframe,
    );
    expect(result.colors).toEqual(["blue", "green", "red"]);
  });

  it("reserves explicit color slots for absent series and cycles the default palette", () => {
    const result = chartSeriesFrom(
      { ...spec, seriesOrder: ["absent", "small"] },
      dataframe,
    );
    expect(result.columns).toEqual(["day", "small", "large", "Other"]);
    expect(result.colors).toEqual([
      DEFAULT_SERIES_COLORS[1],
      DEFAULT_SERIES_COLORS[3],
      DEFAULT_SERIES_COLORS[2],
    ]);
  });

  it("preserves first-seen order for unstacked and line charts", () => {
    expect(
      chartSeriesFrom({ ...spec, stacked: false }, dataframe).columns,
    ).toEqual(["day", "Other", "small", "large"]);
    expect(
      chartSeriesFrom({ ...spec, mark: "line" }, dataframe).columns,
    ).toEqual(["day", "Other", "small", "large"]);
  });
});

describe("A2-DATAFRAME-DECIMAL-CHARTS", () => {
  it("pivots decimal strings in stack order without changing raw categories or source rows", () => {
    const source: ChartDataframe = {
      name: "decimal",
      cellId: "source",
      columns: dataframe.columns,
      rows: [
        ["001", "small", "0.1"],
        ["001", "large", "1.25"],
        ["002", "small", "0.2"],
        ["002", "large", "2e0"],
      ],
    };
    const before = structuredClone(source);
    const result = chartSeriesFrom(spec, source);
    expect(result.columns).toEqual(["day", "large", "small"]);
    expect(result.rows).toEqual([
      ["001", 1.25, 0.1],
      ["002", 2, 0.2],
    ]);
    expect(source).toEqual(before);
  });
});

it("leaves numeric category and series identifiers raw and rejects invalid measures", () => {
  const source: ChartDataframe = {
    name: "invalid",
    cellId: "source",
    columns: [
      { name: "day", type: "number" },
      { name: "group", type: "number" },
      { name: "count", type: "number" },
    ],
    rows: [
      ["001", "002", ""],
      ["003", "002", " "],
      ["004", "002", "Infinity"],
      ["005", "002", "1e999"],
      ["006", "002", true],
      ["007", "002", null],
      ["008", "002", ".5e+1"],
    ],
  };
  const result = chartSeriesFrom(spec, source);
  expect(result.columns).toEqual(["day", "002"]);
  expect(result.rows).toEqual([
    ["001", null],
    ["003", null],
    ["004", null],
    ["005", null],
    ["006", null],
    ["007", null],
    ["008", 5],
  ]);
});

it("projects a measure even when the unused series selection names it", () => {
  const source: ChartDataframe = {
    name: "decimal",
    cellId: "source",
    columns: dataframe.columns,
    rows: [["001", "group", "0.1"]],
  };
  expect(
    chartSeriesFrom({ ...spec, seriesField: "count" }, source).rows,
  ).toEqual([["001", 0.1]]);
});

describe("report ASK84-PIVOT-COLORS-AND-FILL", () => {
  const frame = (
    rows: Array<Array<string | number | null>>,
    group = "template",
  ): ChartDataframe => ({
    name: "pivot",
    cellId: "source",
    columns: [
      { name: "day", type: "string" },
      { name: group, type: "string" },
      { name: "count", type: "number" },
    ],
    rows,
  });
  const pivot: ChartSpec = {
    mark: "area",
    xField: "day",
    yField: "count",
    seriesField: "template",
    stacked: true,
    title: null,
  };

  it("draws apps in their fixed colors, unknown in its own and other series muted", () => {
    const result = chartSeriesFrom(
      pivot,
      frame([
        ["2026-08-01", "mail", 9],
        ["2026-08-01", "docs", 5],
        ["2026-08-01", "unknown", 4],
        ["2026-08-01", "clips", 3],
        ["2026-08-01", "site", 1],
      ]),
    );
    expect(result.columns.slice(1)).toEqual([
      "mail",
      "docs",
      "clips",
      "site",
      "unknown",
    ]);
    expect(result.colors).toEqual([
      APP_SERIES_COLORS.mail,
      NON_APP_SERIES_COLORS[0],
      APP_SERIES_COLORS.clips,
      NON_APP_SERIES_COLORS[1],
      UNKNOWN_APP_COLOR,
    ]);
  });

  it("uses the default palette by slot when the series column is not an app column", () => {
    const result = chartSeriesFrom(
      { ...pivot, seriesField: "channel" },
      frame(
        [
          ["2026-08-01", "mail", 2],
          ["2026-08-01", "Paid", 1],
        ],
        "channel",
      ),
    );
    expect(result.colors).toEqual([
      DEFAULT_SERIES_COLORS[0],
      DEFAULT_SERIES_COLORS[1],
    ]);
  });

  it("fills a missing combination and a missing calendar day with zero but keeps an unreadable value as a gap", () => {
    const result = chartSeriesFrom(
      { ...pivot, stacked: false, mark: "line" },
      frame([
        ["2026-08-01", "mail", 2],
        ["2026-08-01", "clips", 1],
        ["2026-08-03", "mail", null],
        ["2026-08-03", "clips", 4],
        ["2026-08-04", "clips", 5],
      ]),
    );
    expect(result.rows).toEqual([
      ["2026-08-01", 2, 1],
      ["2026-08-02", 0, 0],
      ["2026-08-03", null, 4],
      ["2026-08-04", 0, 5],
    ]);
  });

  it("fills absent series and missing days when the day column carries timestamps", () => {
    const result = chartSeriesFrom(
      { ...pivot, stacked: false, mark: "line" },
      frame([
        ["2026-08-01T00:00:00Z", "mail", 2],
        ["2026-08-01T00:00:00Z", "clips", 1],
        ["2026-08-03T00:00:00Z", "clips", 4],
      ]),
    );
    expect(result.rows.map((row) => row[0])).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
    expect(result.rows.map((row) => row.slice(1))).toEqual([
      [2, 1],
      [0, 0],
      [0, 4],
    ]);
  });

  it("does not add calendar days to a bar pivot", () => {
    const result = chartSeriesFrom(
      { ...pivot, mark: "bar" },
      frame([
        ["2026-08-01", "mail", 2],
        ["2026-08-03", "mail", 4],
      ]),
    );
    expect(result.rows.map((row) => row[0])).toEqual([
      "2026-08-01",
      "2026-08-03",
    ]);
  });
});
