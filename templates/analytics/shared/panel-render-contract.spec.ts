import { describe, expect, it } from "vitest";

import { validateFirstPartyAnalyticsSql } from "../server/lib/first-party-analytics";
import {
  PANEL_CHART_TYPES,
  PANEL_TOP_LEVEL_KEYS,
  clipHead,
  duplicatePanelIds,
  editDistance,
  isNumericLikeValue,
  limitChartRows,
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
