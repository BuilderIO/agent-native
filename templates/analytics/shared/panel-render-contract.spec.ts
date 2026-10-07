import { describe, expect, it } from "vitest";

import {
  PANEL_CHART_TYPES,
  editDistance,
  isNumericLikeValue,
  missingKeysFromColumns,
  planPanelRender,
  stableStringify,
  unknownPanelConfigKeys,
  validatePanelContract,
} from "./panel-render-contract";

const wideRows = [
  { week: "2026-09-01", app_a: 3, app_b: 4, viral_coefficient: 0.3 },
  { week: "2026-09-08", app_a: 5, app_b: 6, viral_coefficient: 0.4 },
];

const longRows = [
  { week: "2026-09-01", app: "a", n: 10, signups_4wk_avg: 9 },
  { week: "2026-09-01", app: "b", n: 20, signups_4wk_avg: 19 },
  { week: "2026-09-08", app: "a", n: 11, signups_4wk_avg: 10 },
  { week: "2026-09-08", app: "b", n: 21, signups_4wk_avg: 20 },
];

describe("planPanelRender", () => {
  it("reports a stale pivot over wide rows as empty with the pivot keys missing", () => {
    const plan = planPanelRender(wideRows, {
      chartType: "line",
      config: {
        pivot: { xKey: "week", seriesKey: "app", valueKey: "sharing_actions" },
      },
    });

    expect(plan.empty).toBe(true);
    expect(plan.rows).toEqual([]);
    expect(plan.rawColumns).toEqual([
      "week",
      "app_a",
      "app_b",
      "viral_coefficient",
    ]);
    expect(plan.missingKeys).toEqual(["app", "sharing_actions"]);
  });

  it("does not call a query that returned no rows missing anything", () => {
    const plan = planPanelRender([], {
      chartType: "line",
      config: {
        yKeys: ["n"],
        pivot: { xKey: "w", seriesKey: "s", valueKey: "v" },
      },
    });

    expect(plan).toMatchObject({
      empty: true,
      missingKeys: [],
      rawColumns: [],
    });
  });

  it("reports yKeys that pivot drops, and the extra column with them", () => {
    const plan = planPanelRender(longRows, {
      chartType: "line",
      config: {
        yKeys: ["n", "signups_4wk_avg"],
        pivot: { xKey: "week", seriesKey: "app", valueKey: "n" },
      },
    });

    expect(plan.empty).toBe(false);
    expect(plan.yKeys).toEqual(["a", "b"]);
    expect(plan.rows.every((row) => !("signups_4wk_avg" in row))).toBe(true);
    expect(plan.missingKeys).toEqual([]);
    expect(plan.ignoredConfig).toEqual([
      expect.objectContaining({
        key: "yKeys",
        reason: expect.stringContaining("Remove config.pivot"),
      }),
    ]);
  });

  it("treats yKey beside pivot as the value column, not an ignored series", () => {
    const plan = planPanelRender(longRows, {
      chartType: "line",
      config: {
        yKey: "n",
        pivot: { xKey: "week", seriesKey: "app", valueKey: "n" },
      },
    });

    expect(plan.yKeys).toEqual(["a", "b"]);
    expect(plan.missingKeys).toEqual([]);
    expect(plan.ignoredConfig).toEqual([]);
  });

  it("plots a rolling-average column listed in yKeys and flags it when absent", () => {
    const rows = [
      { week: "2026-09-01", signups: 10, signups_4wk_avg: 9 },
      { week: "2026-09-08", signups: 12, signups_4wk_avg: 10 },
    ];
    const withColumn = planPanelRender(rows, {
      chartType: "line",
      config: { yKeys: ["signups", "signups_4wk_avg"] },
    });
    expect(withColumn.yKeys).toEqual(["signups", "signups_4wk_avg"]);
    expect(withColumn.missingKeys).toEqual([]);
    expect(withColumn.ignoredConfig).toEqual([]);

    const withoutColumn = planPanelRender(
      rows.map(({ signups_4wk_avg: _avg, ...row }) => row),
      { chartType: "line", config: { yKeys: ["signups", "signups_4wk_avg"] } },
    );
    expect(withoutColumn.yKeys).toEqual(["signups"]);
    expect(withoutColumn.missingKeys).toEqual(["signups_4wk_avg"]);
  });

  it("reports combo barKeys and rightYKeys the renderer would ignore", () => {
    const rows = [
      { week: "2026-09-01", a: 1, b: 2, c: 3 },
      { week: "2026-09-08", a: 4, b: 5, c: 6 },
    ];
    const barKeys = planPanelRender(rows, {
      chartType: "combo",
      config: { yKeys: ["a", "b"], barKeys: ["a", "c"] },
    });
    expect(barKeys.ignoredConfig).toEqual([
      expect.objectContaining({ key: "barKeys" }),
    ]);

    const everySeriesRight = planPanelRender(rows, {
      chartType: "line",
      config: { yKeys: ["a", "b"], rightYKeys: ["a", "b"] },
    });
    expect(everySeriesRight.ignoredConfig).toEqual([
      expect.objectContaining({
        key: "rightYKeys",
        reason: expect.stringContaining("dual-axis is disabled"),
      }),
    ]);

    const rightNotPlotted = planPanelRender(rows, {
      chartType: "line",
      config: { yKeys: ["a"], rightYKeys: ["b"] },
    });
    expect(rightNotPlotted.ignoredConfig).toEqual([
      expect.objectContaining({
        key: "rightYKeys",
        reason: expect.stringContaining("not among the plotted series"),
      }),
    ]);

    const barKeysOnLine = planPanelRender(rows, {
      chartType: "line",
      config: { yKeys: ["a"], barKeys: ["a"] },
    });
    expect(barKeysOnLine.ignoredConfig).toEqual([
      expect.objectContaining({ key: "barKeys" }),
    ]);
  });

  it("checks the heatmap row column and table columns against the result", () => {
    const heatmap = planPanelRender(
      [{ cohort: "w1", day: "d1", retained: 0.5 }],
      {
        chartType: "heatmap",
        config: { xKey: "day", yKey: "retained", color: "segment" },
      },
    );
    expect(heatmap.missingKeys).toEqual(["segment"]);

    const table = planPanelRender([{ path: "/a" }], {
      chartType: "table",
      config: { columns: [{ key: "path", linkKey: "url" }, { key: "views" }] },
    });
    expect(table.missingKeys).toEqual(["url", "views"]);
  });

  it("detects keys the way the renderer does for an unconfigured panel", () => {
    const plan = planPanelRender(
      [
        { day: "2026-09-01", n: 1, label: "x" },
        { day: "2026-09-02", n: 2, label: "y" },
      ],
      { chartType: "line" },
    );

    expect(plan).toMatchObject({
      xKey: "day",
      yKeys: ["n"],
      empty: false,
      missingKeys: [],
      ignoredConfig: [],
    });
  });
});

describe("missingKeysFromColumns", () => {
  it("binds config against a schema without rows", () => {
    expect(
      missingKeysFromColumns(["week", "n"], {
        chartType: "line",
        config: { xKey: "week", yKeys: ["n", "n_avg"], rightYKeys: ["gone"] },
      }),
    ).toEqual(["n_avg", "gone"]);
  });

  it("checks pivot keys and skips the shape pivot produces", () => {
    expect(
      missingKeysFromColumns(["week", "n"], {
        chartType: "line",
        config: {
          xKey: "week_label",
          pivot: { xKey: "week", seriesKey: "app", valueKey: "n" },
        },
      }),
    ).toEqual(["app"]);
  });
});

describe("unknownPanelConfigKeys", () => {
  const panel = (config: Record<string, unknown>, extra = {}) => ({
    id: "viral",
    title: "Virality",
    chartType: "line",
    config,
    ...extra,
  });

  it("suggests yFormatter for yAxis and names the panel", () => {
    const [issue] = unknownPanelConfigKeys(
      panel({ yAxis: { format: "percent" } }),
    );

    expect(issue).toMatchObject({
      kind: "unknown-key",
      key: "yAxis",
      didYouMean: "yFormatter",
    });
    expect(issue.message).toContain('panel "viral" ("Virality")');
    expect(issue.message).toContain("Honored config keys: ");
  });

  it("answers a rolling or moving average with the SQL-column recipe", () => {
    for (const key of ["movingAverage", "rollingAverage", "rolling"]) {
      const [issue] = unknownPanelConfigKeys(panel({ [key]: 4 }));
      expect(issue.message).toContain("window-function column");
      expect(issue.message).toContain("config.yKeys");
      expect(issue.message).toContain("config.pivot");
      expect(issue.didYouMean).toBeUndefined();
    }
  });

  it("flags renderer options placed on the panel instead of config", () => {
    const issues = unknownPanelConfigKeys(
      panel({}, { yKeys: ["a"], bogus: true }),
    );

    expect(issues).toEqual([
      expect.objectContaining({ kind: "misplaced-key", key: "yKeys" }),
      expect.objectContaining({ kind: "unknown-key", key: "bogus" }),
    ]);
  });

  it("flags an unknown chartType and options on the wrong chart type", () => {
    const issues = unknownPanelConfigKeys(
      panel({ barKeys: ["a"], color: "#fff" }, { chartType: "lines" }),
    );

    expect(issues.map((issue) => issue.kind)).toEqual([
      "unknown-chart-type",
      "wrong-chart-type",
      "wrong-chart-type",
    ]);
    expect(issues[0].didYouMean).toBe("line");
    expect(issues[2].message).toContain("config.colors");
  });

  it("accepts every registered chart type, legacy aliases, and unset keys", () => {
    for (const chartType of [...PANEL_CHART_TYPES, "stacked-bar"]) {
      expect(
        unknownPanelConfigKeys(
          panel({ xKey: "x", yAxis: null }, { chartType }),
        ),
      ).toEqual([]);
    }
    expect(PANEL_CHART_TYPES).toContain("combo");
  });
});

describe("validatePanelContract", () => {
  const legacy = {
    id: "legacy",
    title: "Legacy",
    chartType: "line",
    config: { yAxis: { format: "percent" } },
    yKeys: ["a"],
  };
  const base: { panels: Record<string, unknown>[] } = {
    panels: [legacy, { id: "other", title: "Other", chartType: "line" }],
  };

  it("never blocks an unrelated edit on a legacy stray key", () => {
    const next = structuredClone(base);
    next.panels[1].title = "Renamed";

    expect(validatePanelContract(base, next, new Set(["other"]))).toEqual([]);
  });

  it("ignores stray keys a touched panel already had, and flags new ones", () => {
    const touchedUnchanged = structuredClone(base);
    touchedUnchanged.panels[0].title = "Legacy renamed";
    expect(
      validatePanelContract(base, touchedUnchanged, new Set(["legacy"])),
    ).toEqual([]);

    const touchedChanged = structuredClone(base);
    (touchedChanged.panels[0].config as Record<string, unknown>).movingAverage =
      4;
    expect(
      validatePanelContract(base, touchedChanged, new Set(["legacy"])),
    ).toEqual([expect.objectContaining({ key: "movingAverage" })]);
  });

  it("checks every key of an inserted panel and works without a base", () => {
    const next = {
      panels: [
        { id: "new", title: "New", chartType: "bar", config: { yAxis: 1 } },
      ],
    };

    expect(validatePanelContract(null, next, new Set(["new"]))).toEqual([
      expect.objectContaining({ key: "yAxis", didYouMean: "yFormatter" }),
    ]);
    expect(validatePanelContract(null, next, new Set())).toEqual([]);
  });
});

describe("helpers", () => {
  it("stringifies objects independent of key order", () => {
    expect(stableStringify({ b: 1, a: { d: 1, c: [{ y: 1, x: 2 }] } })).toBe(
      stableStringify({ a: { c: [{ x: 2, y: 1 }], d: 1 }, b: 1 }),
    );
    expect(stableStringify(undefined)).toBe("undefined");
  });

  it("measures edit distance case-insensitively", () => {
    expect(editDistance("YKeys", "yKeys")).toBe(0);
    expect(editDistance("yKey", "yKeys")).toBe(1);
  });

  it("treats numeric strings as numeric values", () => {
    expect(isNumericLikeValue("12.5")).toBe(true);
    expect(isNumericLikeValue(" ")).toBe(false);
    expect(isNumericLikeValue(Number.NaN)).toBe(false);
  });
});
