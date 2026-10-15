import { describe, expect, it } from "vitest";

import { validateFirstPartyAnalyticsSql } from "../server/lib/first-party-analytics";
import {
  PANEL_CHART_TYPES,
  PANEL_TOP_LEVEL_KEYS,
  chartPointLimit,
  clipHead,
  duplicatePanelIds,
  editDistance,
  isNumericLikeValue,
  limitChartRows,
  missingKeysFromColumns,
  orderPanelSeries,
  planPanelRender,
  resolveSeriesColors,
  stableStringify,
  unknownPanelConfigKeys,
  validatePanelContract,
} from "./panel-render-contract";
import {
  APP_SERIES_COLORS,
  NON_APP_SERIES_COLORS,
  UNKNOWN_APP_COLOR,
} from "./tokens/app-series-colors";

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

describe("planPanelRender empty for funnel and heatmap", () => {
  it("is empty when the funnel reader finds no label/value items", () => {
    const funnel = (rows: Record<string, unknown>[]) =>
      planPanelRender(rows, {
        chartType: "funnel",
        config: { xKey: "stage", yKey: "users" },
      });

    for (const rows of [
      [
        { stage: 1, users: 100 },
        { stage: 2, users: 50 },
      ],
      [
        { stage: null, users: 100 },
        { stage: "", users: 50 },
      ],
      [
        { stage: "visit", users: -1 },
        { stage: "signup", users: -5 },
      ],
      [{ stage: new Date("2026-09-01"), users: 3 }],
    ]) {
      const plan = funnel(rows);
      expect(plan.rows.length).toBeGreaterThan(0);
      expect(plan).toMatchObject({ empty: true, renderedRowCount: 0 });
      expect(plan.funnel?.items).toEqual([]);
    }

    const healthy = funnel([
      { stage: "visit", users: 100 },
      { stage: "signup", users: 40 },
      { stage: null, users: 9 },
    ]);
    expect(healthy.empty).toBe(false);
    expect(healthy.renderedRowCount).toBe(2);
    expect(healthy.funnel?.items.map((item) => item.label)).toEqual([
      "visit",
      "signup",
    ]);
  });

  it("is empty when the heatmap has no value column to read", () => {
    const heatmap = (rows: Record<string, unknown>[]) =>
      planPanelRender(rows, { chartType: "heatmap" });

    const oneColumn = heatmap([{ cohort: "w1" }, { cohort: "w2" }]);
    expect(oneColumn).toMatchObject({ empty: true, renderedRowCount: 0 });
    expect(oneColumn.heatmap?.valueKey).toBe("");

    const withValues = heatmap([{ cohort: "w1", retained: 0.5 }]);
    expect(withValues.empty).toBe(false);
    expect(withValues.heatmap).toMatchObject({
      xKey: "cohort",
      valueKey: "retained",
    });
  });

  it("judges only the rows the renderer keeps when a funnel has more than the point cap", () => {
    const rows = [
      ...Array.from({ length: 400 }, (_, i) => ({ stage: i, users: 1 })),
      { stage: "late", users: 5 },
    ];

    const plan = planPanelRender(rows, {
      chartType: "funnel",
      config: { xKey: "stage", yKey: "users" },
    });

    expect(plan.empty).toBe(true);
    expect(limitChartRows(rows, "funnel")).toHaveLength(400);
  });

  it("leaves other chart types alone", () => {
    const plan = planPanelRender([{ stage: 1, users: 100 }], {
      chartType: "bar",
    });

    expect(plan).toMatchObject({ empty: false, funnel: null, heatmap: null });
    expect(plan.renderedRowCount).toBe(1);
  });
});

describe("planPanelRender with malformed key lists", () => {
  const rows = [
    { week: "2026-09-01", signups: 3, rate: 0.3 },
    { week: "2026-09-08", signups: 5, rate: 0.4 },
  ];

  it("does not throw on a string where the renderer tolerates one", () => {
    expect(() =>
      planPanelRender(rows, {
        chartType: "line",
        config: { rightYKeys: "rate" } as never,
      }),
    ).not.toThrow();
    expect(() =>
      planPanelRender(rows, {
        chartType: "combo",
        config: { yKeys: ["signups"], barKeys: "signups" } as never,
      }),
    ).not.toThrow();
  });

  it("treats a non-array yKeys as unset instead of crashing detection", () => {
    const plan = planPanelRender(rows, {
      chartType: "line",
      config: { yKeys: "rate", yKey: "rate" } as never,
    });

    expect(plan.yKeys).toEqual(["rate"]);
    expect(plan.empty).toBe(false);
  });
});

describe("unknownPanelConfigKeys on shipped panels and value shapes", () => {
  const stray = (chartType: string, config: Record<string, unknown>) => ({
    id: "sessions",
    title: "Sessions",
    chartType,
    config,
  });

  it("does not re-flag an unchanged inert color when only the chart type changes", () => {
    const base = stray("area", { color: "#5b8def", yKeys: ["n"] });
    const next = stray("line", { color: "#5b8def", yKeys: ["n"] });

    expect(unknownPanelConfigKeys(next, base)).toEqual([]);
  });

  it("still flags a color that was added or changed on a non-heatmap panel", () => {
    const base = stray("area", { yKeys: ["n"] });

    expect(
      unknownPanelConfigKeys(stray("area", { color: "#fff" }), base),
    ).toEqual([expect.objectContaining({ kind: "wrong-chart-type" })]);
    expect(
      unknownPanelConfigKeys(
        stray("line", { color: "#000" }),
        stray("area", { color: "#fff" }),
      ),
    ).toEqual([expect.objectContaining({ kind: "wrong-chart-type" })]);
  });

  it("accepts legacy panel fields under config because the store promotes them", () => {
    const issues = unknownPanelConfigKeys({
      id: "legacy",
      title: "Legacy",
      chartType: "line",
      config: {
        width: 3,
        title: "Renamed",
        sql: "SELECT 1",
        source: "bigquery",
        tab: "growth",
        yKeys: ["n"],
      },
    });

    expect(issues).toEqual([]);
  });

  it("flags a misshapen key list or pivot with the offending key", () => {
    const issues = unknownPanelConfigKeys(
      stray("combo", {
        yKeys: "n",
        rightYKeys: [1],
        barKeys: { a: 1 },
        pivot: { xKey: "week" },
      }),
    );

    expect(issues.map((issue) => [issue.kind, issue.key])).toEqual([
      ["invalid-value", "yKeys"],
      ["invalid-value", "rightYKeys"],
      ["invalid-value", "barKeys"],
      ["invalid-value", "pivot"],
    ]);
    expect(issues[0].message).toContain("config.yKeys must be an array");
  });

  it("does not flag a misshapen value the baseline already had", () => {
    const config = { yKeys: "n" };

    expect(
      unknownPanelConfigKeys(stray("line", config), stray("line", config)),
    ).toEqual([]);
  });
});

describe("rolling-average hint by source", () => {
  const hintFor = (source: string) =>
    unknownPanelConfigKeys({
      id: "p",
      title: "P",
      source,
      chartType: "line",
      config: { rollingAverage: 4 },
    })[0].message;
  const exampleIn = (message: string) =>
    /for example (.+?) AS value_4wk_avg/.exec(message)?.[1] ?? "";
  const query = (expression: string) =>
    `SELECT date_trunc('week', timestamp) AS week, ${expression} AS value_4wk_avg FROM analytics_events GROUP BY 1`;

  it("recommends a window function the first-party SQL policy accepts", () => {
    const message = hintFor("first-party");

    expect(message).toContain("window-function column");
    expect(message).toContain("AVG is not an approved function");
    expect(() =>
      validateFirstPartyAnalyticsSql(query(exampleIn(message))),
    ).not.toThrow();
  });

  it("keeps AVG() OVER for BigQuery, which the first-party policy would reject", () => {
    const message = hintFor("bigquery");

    expect(exampleIn(message)).toContain("AVG(value) OVER");
    expect(message).not.toContain("not an approved function");
    expect(() =>
      validateFirstPartyAnalyticsSql(query(exampleIn(message))),
    ).toThrow(/unapproved SQL function/);
  });
});

describe("duplicate panel ids", () => {
  const dup = (title: string) => ({
    id: "dup",
    title,
    chartType: "line",
  });

  it("blocks a touched panel whose id is shared and names the problem once", () => {
    const base = { panels: [dup("A"), dup("B")] };
    const next = { panels: [dup("A edited"), dup("B")] };

    expect(validatePanelContract(base, next, new Set(["dup"]))).toEqual([
      expect.objectContaining({
        kind: "duplicate-panel-id",
        panelId: "dup",
      }),
    ]);
    expect(validatePanelContract(base, next, new Set())).toEqual([]);
  });

  it("says plainly that the dashboard has duplicate ids and how to fix it, even when the duplicate was already saved", () => {
    const saved = { panels: [dup("A"), dup("B")] };

    const [issue] = validatePanelContract(saved, saved, new Set(["dup"]));

    expect(issue.message).toContain("this dashboard has duplicate panel ids");
    expect(issue.message).toContain("Rename one copy");
    expect(issue.message).toContain("/panels/<index>/id");
  });

  it("finds ids that appear more than once", () => {
    expect(
      duplicatePanelIds([dup("A"), { id: "solo" }, dup("B"), "junk"]),
    ).toEqual(new Set(["dup"]));
  });
});

describe("clipHead", () => {
  const LONE_SURROGATE =
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  it("leaves text within the limit alone", () => {
    expect(clipHead("abc", 3)).toBe("abc");
    expect(clipHead("", 3)).toBe("");
  });

  it("cuts plain text at the limit", () => {
    expect(clipHead("abcdef", 4)).toBe("abcd");
  });

  it("drops half an emoji instead of keeping a lone surrogate", () => {
    const text = `ab${"😀"}cd`;

    expect(clipHead(text, 3)).toBe("ab");
    expect(clipHead(text, 4)).toBe("ab😀");
    expect(clipHead(text, 3)).not.toMatch(LONE_SURROGATE);
  });

  it("keeps a panel label with an emoji at the cut well formed", () => {
    for (const prefix of ["", "x"]) {
      const [issue] = validatePanelContract(
        null,
        {
          panels: [
            {
              id: "p",
              title: `${prefix}${"😀".repeat(60)}`,
              chartType: "line",
              config: { rollingAvg: 4 },
            },
          ],
        },
        new Set(["p"]),
      );

      expect(issue.message).not.toMatch(LONE_SURROGATE);
    }
  });
});

describe("PANEL_TOP_LEVEL_KEYS", () => {
  it("lists every SqlPanel field in a stable order", () => {
    expect(PANEL_TOP_LEVEL_KEYS).toEqual([
      "id",
      "title",
      "sql",
      "source",
      "chartType",
      "width",
      "columns",
      "config",
      "tab",
    ]);
  });
});

describe("orderPanelSeries", () => {
  const rows = [
    { day: "2026-09-01", other: 900, mail: 5, slides: 50, "(unknown)": 1 },
    { day: "2026-09-02", other: 900, mail: 5, slides: 50, "(unknown)": 1 },
  ];
  const keys = ["other", "mail", "slides", "(unknown)"];

  it("puts the largest stacked series first and catch-all buckets last", () => {
    expect(
      orderPanelSeries(rows, keys, {
        chartType: "area",
        config: { stacked: true },
      }),
    ).toEqual(["slides", "mail", "other", "(unknown)"]);
  });

  it("treats a legacy stacked-bar chart type like a bar", () => {
    expect(
      orderPanelSeries(rows, keys, {
        chartType: "stacked-bar" as never,
        config: { stacked: true },
      }),
    ).toEqual(["slides", "mail", "other", "(unknown)"]);
  });

  it("keeps result order when the chart is not stacked", () => {
    expect(
      orderPanelSeries(rows, keys, { chartType: "line", config: {} }),
    ).toEqual(keys);
    expect(
      orderPanelSeries(rows, keys, { chartType: "bar", config: {} }),
    ).toEqual(keys);
  });

  it("keeps an explicit yKeys list as written", () => {
    expect(
      orderPanelSeries(rows, ["mail", "slides"], {
        chartType: "bar",
        config: { stacked: true, yKeys: ["mail", "slides"] },
      }),
    ).toEqual(["mail", "slides"]);
  });

  it("draws pivot.seriesOrder first, then ranks the rest", () => {
    expect(
      orderPanelSeries(rows, keys, {
        chartType: "bar",
        config: {
          stacked: true,
          pivot: {
            xKey: "day",
            seriesKey: "app",
            valueKey: "n",
            seriesOrder: ["other", "absent"],
          },
        },
      }),
    ).toEqual(["other", "slides", "mail", "(unknown)"]);
  });

  it("orders a pivoted stacked area by series total", () => {
    const plan = planPanelRender(
      [
        { date: "2026-09-01", template: "mail", count: 2 },
        { date: "2026-09-01", template: "analytics", count: 40 },
        { date: "2026-09-01", template: "unknown", count: 100 },
        { date: "2026-09-02", template: "mail", count: 3 },
        { date: "2026-09-02", template: "slides", count: 12 },
      ],
      {
        chartType: "area",
        config: {
          stacked: true,
          pivot: { xKey: "date", seriesKey: "template", valueKey: "count" },
        },
      },
    );

    expect(plan.yKeys).toEqual(["analytics", "slides", "mail", "unknown"]);
  });

  it("keeps each series' configured color when ranking moves it", () => {
    const plan = planPanelRender(
      [
        { model: "a", sentiment: "positive", responses: 5 },
        { model: "a", sentiment: "negative", responses: 20 },
        { model: "b", sentiment: "positive", responses: 10 },
        { model: "b", sentiment: "negative", responses: 18 },
      ],
      {
        chartType: "bar",
        config: {
          stacked: true,
          colors: ["#10b981", "#ef4444"],
          pivot: {
            xKey: "model",
            seriesKey: "sentiment",
            valueKey: "responses",
          },
        },
      },
    );

    expect(plan.yKeys).toEqual(["negative", "positive"]);
    expect(plan.colorSlots).toEqual([1, 0]);
  });

  it("anchors colors to pivot.seriesOrder whatever order rows arrive in", () => {
    const plan = planPanelRender(
      [
        { model: "a", sentiment: "negative", responses: 20 },
        { model: "a", sentiment: "positive", responses: 5 },
        { model: "b", sentiment: "neutral", responses: 1 },
      ],
      {
        chartType: "bar",
        config: {
          stacked: true,
          colors: ["#10b981", "#ef4444", "#94a3b8"],
          pivot: {
            xKey: "model",
            seriesKey: "sentiment",
            valueKey: "responses",
            seriesOrder: ["positive", "negative"],
          },
        },
      },
    );

    expect(plan.yKeys).toEqual(["positive", "negative", "neutral"]);
    expect(plan.colorSlots).toEqual([0, 1, 2]);
  });
});

describe("resolveSeriesColors", () => {
  const PALETTE = ["#06b6d4", "#ef4444", "#f59e0b"];
  const byApp = {
    chartType: "area" as const,
    config: {
      stacked: true,
      pivot: { xKey: "day", seriesKey: "template", valueKey: "visitors" },
    },
  };

  function colorsByKey(
    rows: Record<string, unknown>[],
    panel: Parameters<typeof planPanelRender>[1],
    palette = PALETTE,
  ) {
    const plan = planPanelRender(rows, panel);
    const colors = resolveSeriesColors(
      plan.yKeys,
      plan.colorSlots,
      panel,
      palette,
    );
    return plan.yKeys.map((key, index) => [key, colors[index]]);
  }

  it("keeps each app's color when result order, stack order and the app set change", () => {
    const first = colorsByKey(
      [
        { day: "2026-10-01", template: "slides", visitors: 2 },
        { day: "2026-10-01", template: "mail", visitors: 9 },
        { day: "2026-10-01", template: "brain", visitors: 1 },
      ],
      byApp,
    );
    const second = colorsByKey(
      [
        { day: "2026-10-01", template: "mail", visitors: 2 },
        { day: "2026-10-01", template: "slides", visitors: 9 },
      ],
      byApp,
    );

    expect(first).toEqual([
      ["mail", APP_SERIES_COLORS.mail],
      ["slides", APP_SERIES_COLORS.slides],
      ["brain", APP_SERIES_COLORS.brain],
    ]);
    expect(second).toEqual([
      ["slides", APP_SERIES_COLORS.slides],
      ["mail", APP_SERIES_COLORS.mail],
    ]);
  });

  it("draws every other series of an app chart muted, never a palette color", () => {
    const rows = [
      { day: "2026-10-01", template: "website", visitors: 4 },
      { day: "2026-10-01", template: "unknown", visitors: 3 },
      { day: "2026-10-01", template: "forms", visitors: 9 },
      { day: "2026-10-01", template: "docs", visitors: 2 },
    ];
    const expected = [
      ["forms", APP_SERIES_COLORS.forms],
      ["website", NON_APP_SERIES_COLORS[0]],
      ["docs", NON_APP_SERIES_COLORS[1]],
      ["unknown", UNKNOWN_APP_COLOR],
    ];

    expect(colorsByKey(rows, byApp)).toEqual(expected);
    expect(colorsByKey(rows, byApp, ["var(--brand-blue)", "#0d9488"])).toEqual(
      expected,
    );
  });

  it("keeps the palette by slot on a chart with no app series", () => {
    expect(
      colorsByKey(
        [
          { day: "2026-10-01", template: "production", visitors: 2 },
          { day: "2026-10-01", template: "unknown", visitors: 9 },
        ],
        byApp,
      ),
    ).toEqual([
      ["production", "#06b6d4"],
      ["unknown", "#ef4444"],
    ]);
  });

  it("keeps the palette on a chart split by another column, whatever its series are named", () => {
    const byChannel = {
      ...byApp,
      config: {
        ...byApp.config,
        pivot: { xKey: "day", seriesKey: "channel", valueKey: "visitors" },
      },
    };
    expect(
      colorsByKey(
        [
          { day: "2026-10-01", channel: "chat", visitors: 9 },
          { day: "2026-10-01", channel: "email", visitors: 2 },
        ],
        byChannel,
      ),
    ).toEqual([
      ["chat", "#06b6d4"],
      ["email", "#ef4444"],
    ]);
  });

  it("reads an `app` pivot column in any case, and app-named columns alone stay on the palette", () => {
    const appColors = [APP_SERIES_COLORS.mail, APP_SERIES_COLORS.slides];
    for (const seriesKey of ["app", " App "]) {
      const panel = {
        ...byApp,
        config: {
          ...byApp.config,
          pivot: { xKey: "day", seriesKey, valueKey: "visitors" },
        },
      };
      expect(
        resolveSeriesColors(["mail", "slides"], [0, 1], panel, PALETTE),
      ).toEqual(appColors);
    }
    const unpivoted = {
      chartType: "line" as const,
      config: { xKey: "day", yKeys: ["mail", "slides"] },
    };
    expect(
      resolveSeriesColors(["mail", "slides"], [0, 1], unpivoted, PALETTE),
    ).toEqual(["#06b6d4", "#ef4444"]);
  });

  it("lets config.colors override the app colors", () => {
    const panel = {
      ...byApp,
      config: { ...byApp.config, colors: PALETTE },
    };
    expect(
      colorsByKey(
        [
          { day: "2026-10-01", template: "mail", visitors: 9 },
          { day: "2026-10-01", template: "slides", visitors: 2 },
        ],
        panel,
      ),
    ).toEqual([
      ["mail", "#06b6d4"],
      ["slides", "#ef4444"],
    ]);
  });
});

describe("chart point limit", () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ n: index }));

  it("keeps the newest points of a time series and says so", () => {
    const days = Array.from({ length: 601 }, (_, index) => ({
      date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
    }));
    expect(chartPointLimit(days, "line", "date")).toEqual({
      shown: 400,
      total: 601,
      keeps: "newest",
    });
    expect(limitChartRows(days, "area", "date")[0]).toEqual(days[201]);
  });

  it("keeps the last points of a line chart over anything but ordered dates, and calls them last", () => {
    const pages = Array.from({ length: 450 }, (_, index) => ({
      page: `/page-${index}`,
    }));
    const busiest = Array.from({ length: 450 }, (_, index) => ({
      date: new Date(Date.UTC(2025, 0, 1 + ((index * 7) % 450)))
        .toISOString()
        .slice(0, 10),
    }));
    const cases: [Record<string, unknown>[], string | undefined][] = [
      [pages, "page"],
      [rows(601), "n"],
      [rows(601), undefined],
      [busiest, "date"],
    ];
    for (const [data, xKey] of cases) {
      for (const chartType of ["line", "area", "combo", "heatmap"]) {
        expect(chartPointLimit(data, chartType, xKey)?.keeps).toBe("last");
      }
      expect(limitChartRows(data, "line", xKey)[0]).toEqual(
        data[data.length - 400],
      );
    }
  });

  it("treats an eight-digit id as a number, not a date", () => {
    const orders = Array.from({ length: 450 }, (_, index) => ({
      order_id: String(10_000_001 + index),
    }));
    expect(chartPointLimit(orders, "bar", "order_id")?.keeps).toBe("first");
    expect(chartPointLimit(orders, "line", "order_id")?.keeps).toBe("last");
  });

  it("keeps the first points of a category chart and says so", () => {
    const categories = Array.from({ length: 450 }, (_, index) => ({
      domain: `site-${index}.example`,
    }));
    expect(chartPointLimit(categories, "bar", "domain")).toEqual({
      shown: 400,
      total: 450,
      keeps: "first",
    });
    expect(chartPointLimit(categories, "stacked-bar", "domain")?.keeps).toBe(
      "first",
    );
    const kept = limitChartRows(categories, "bar", "domain");
    expect(kept[kept.length - 1]).toEqual({ domain: "site-399.example" });
  });

  it("keeps the newest points of a bar chart over dates", () => {
    const days = Array.from({ length: 450 }, (_, index) => ({
      date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
      count: index,
    }));
    expect(chartPointLimit(days, "bar", "date")?.keeps).toBe("newest");
    const kept = limitChartRows(days, "bar", "date");
    expect(kept[0]?.date).toBe("2025-02-20");
    expect(kept[kept.length - 1]?.date).toBe("2026-03-26");
  });

  it("keeps the newest points when dates run newest-first", () => {
    const days = Array.from({ length: 450 }, (_, index) => ({
      date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
      count: index,
    })).reverse();
    for (const chartType of ["bar", "line"]) {
      const kept = limitChartRows(days, chartType, "date");
      expect(kept[0]?.date).toBe("2026-03-26");
      expect(kept[kept.length - 1]?.date).toBe("2025-02-20");
    }
  });

  it("keeps the newest of newest-first weeks", () => {
    const weeks = Array.from({ length: 450 }, (_, index) => ({
      week: `${2026 - Math.floor(index / 52)}-W${String(52 - (index % 52)).padStart(2, "0")}`,
      count: index,
    }));
    expect(chartPointLimit(weeks, "bar", "week")?.keeps).toBe("newest");
    expect(limitChartRows(weeks, "bar", "week")[0]?.week).toBe("2026-W52");
  });

  it("keeps the first points of a bar chart whose date order is unknown", () => {
    const days = Array.from({ length: 450 }, (_, index) => ({
      day: `Oct ${String((index % 28) + 1).padStart(2, "0")}`,
      count: index,
    }));
    expect(chartPointLimit(days, "bar", "day")?.keeps).toBe("first");
    expect(limitChartRows(days, "bar", "day")[0]).toEqual(days[0]);
  });

  it("keeps the newest points of a bar chart over month-name dates with a year", () => {
    const days = Array.from(
      { length: 450 },
      (_, index) => new Date(Date.UTC(2025, 0, 1 + index)),
    ).map((day) => ({
      day: day.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }),
    }));
    expect(chartPointLimit(days, "bar", "day")?.keeps).toBe("newest");
    expect(limitChartRows(days, "bar", "day")[0]).toEqual(days[50]);
  });

  it("keeps the first points of a bar chart over dates sorted by value", () => {
    const busiest = Array.from({ length: 450 }, (_, index) => ({
      date: new Date(Date.UTC(2025, 0, 1 + ((index * 7) % 450)))
        .toISOString()
        .slice(0, 10),
      count: 450 - index,
    }));
    expect(chartPointLimit(busiest, "bar", "date")?.keeps).toBe("first");
    expect(limitChartRows(busiest, "bar", "date")[0]).toEqual(busiest[0]);
  });

  it("keeps the first points of a bar chart over numeric ids", () => {
    const accounts = Array.from({ length: 500 }, (_, index) => ({
      account_id: 9000 - index,
      revenue: 500 - index,
    }));
    expect(chartPointLimit(accounts, "bar", "account_id")?.keeps).toBe("first");
    expect(limitChartRows(accounts, "bar", "account_id")[0]).toEqual({
      account_id: 9000,
      revenue: 500,
    });
  });

  it("has no limit at or under the cap, or for tables", () => {
    expect(chartPointLimit(rows(400), "line")).toBeNull();
    expect(chartPointLimit(rows(5000), "table")).toBeNull();
  });

  it("is part of the render plan", () => {
    const plan = planPanelRender(
      Array.from({ length: 601 }, (_, index) => ({
        date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
        n: index,
      })),
      { chartType: "line", config: { xKey: "date", yKey: "n" } },
    );

    expect(plan.renderedRowCount).toBe(601);
    expect(plan.pointLimit).toEqual({
      shown: 400,
      total: 601,
      keeps: "newest",
    });
  });
});

describe("pivot.seriesOrder shape", () => {
  const pivotPanel = (pivot: Record<string, unknown>) => ({
    id: "p",
    title: "P",
    chartType: "bar",
    config: { pivot },
  });
  const pivot = { xKey: "day", seriesKey: "app", valueKey: "n" };

  it("accepts a list of series values", () => {
    expect(
      unknownPanelConfigKeys(pivotPanel({ ...pivot, seriesOrder: ["mail"] })),
    ).toEqual([]);
  });

  it("flags a seriesOrder that is not a list of strings", () => {
    expect(
      unknownPanelConfigKeys(pivotPanel({ ...pivot, seriesOrder: "mail" })),
    ).toEqual([
      expect.objectContaining({ kind: "invalid-value", key: "pivot" }),
    ]);
  });
});
