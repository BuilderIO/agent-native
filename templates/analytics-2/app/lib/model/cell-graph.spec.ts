import { describe, expect, it } from "vitest";

import { relatedCellIds } from "./cell-graph";
import type { CellContents } from "./contracts";

const base = {
  order: "a",
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
} as const;
const sql = (id: string, source: string, resultVariable: string | null) => ({
  id,
  contents: {
    ...base,
    id,
    kind: "sql",
    source,
    dataConnectionId: null,
    databaseSchema: null,
    resultVariable,
    outputResult: true,
  } as CellContents,
});
const input = (id: string, name: string) => ({
  id,
  contents: {
    ...base,
    id,
    kind: "input",
    name,
    inputType: "TEXT_INPUT",
    defaultValueString: "",
  } as CellContents,
});
const chart = (id: string, dataframe: string | null) => ({
  id,
  contents: {
    ...base,
    id,
    kind: "chart",
    dataframe,
    chartSpec: {},
  } as unknown as CellContents,
});
const markdown = (id: string) => ({
  id,
  contents: { ...base, id, kind: "markdown", markdown: "" } as CellContents,
});

// region input -> orders (reads the input) -> top (reads orders as a table)
//   -> chart_top (charts top) ; chart_orders charts orders ; notes is unrelated.
const cells = [
  input("in", "region"),
  sql("orders", "select * from t where r = {{ region }}", "orders"),
  sql("top", "select * from orders order by 1", "top"),
  chart("chart_top", "top"),
  chart("chart_orders", "orders"),
  markdown("notes"),
];

describe("relatedCellIds", () => {
  it("finds what a cell is built from, through inputs and earlier results", () => {
    expect(relatedCellIds(cells, "top", "upstream")).toEqual([
      "in",
      "orders",
      "top",
    ]);
  });
  it("finds what a cell feeds, through tables and charts", () => {
    expect(relatedCellIds(cells, "orders", "downstream")).toEqual([
      "orders",
      "top",
      "chart_top",
      "chart_orders",
    ]);
  });
  it("joins both directions in notebook order", () => {
    expect(relatedCellIds(cells, "top", "both")).toEqual([
      "in",
      "orders",
      "top",
      "chart_top",
    ]);
  });
  it("leaves an unrelated cell alone and returns nothing for an unknown id", () => {
    expect(relatedCellIds(cells, "notes", "both")).toEqual(["notes"]);
    expect(relatedCellIds(cells, "missing", "both")).toEqual([]);
  });
  it("needs an earlier cell only for a table read, never loops, and follows inputs and dataframes wherever they sit", () => {
    const later = [
      sql("a", "select * from b", "a"),
      sql("b", "select * from a", "b"),
    ];
    // a reads b as a table but b comes later, so only b -> a counts.
    expect(relatedCellIds(later, "a", "upstream")).toEqual(["a"]);
    expect(relatedCellIds(later, "a", "downstream")).toEqual(["a", "b"]);
    expect(relatedCellIds(later, "b", "upstream")).toEqual(["a", "b"]);
    // An input after the query that templates it still feeds it.
    const reordered = [
      sql("q", "select * from t where r = {{ region }}", "q"),
      input("in", "region"),
      chart("ch", "q"),
    ];
    expect(relatedCellIds(reordered, "q", "both")).toEqual(["q", "in", "ch"]);
  });
  it("connects a query-driven dropdown to its source query and to what it filters", () => {
    const dynamic = [
      sql("opts", "select distinct code from regions", "opts"),
      {
        id: "pick",
        contents: {
          ...base,
          id: "pick",
          kind: "input",
          name: "region",
          inputType: "DROPDOWN",
          defaultValueString: "",
          optionsSource: { dataframe: "opts", valueColumn: "code" },
        } as CellContents,
      },
      sql("use", "select * from t where r = {{ region }}", "use"),
      chart("viz", "use"),
      sql("other", "select 1", "other"),
    ];
    expect(relatedCellIds(dynamic, "use", "upstream")).toEqual([
      "opts",
      "pick",
      "use",
    ]);
    expect(relatedCellIds(dynamic, "opts", "downstream")).toEqual([
      "opts",
      "pick",
      "use",
      "viz",
    ]);
    expect(relatedCellIds(dynamic, "other", "both")).toEqual(["other"]);
  });
  it("treats a result variable with regular-expression characters literally", () => {
    const odd = [
      sql("dot", "select 1", "a.b"),
      sql("br", "select 1", "x[y]"),
      sql("plus", "select 1", "a+b"),
      sql("user", "select * from axb join x[y] join aab", "user"),
    ];
    // "a.b" must not match the relation axb; x[y] must not throw.
    expect(relatedCellIds(odd, "user", "upstream")).toEqual(["br", "user"]);
  });
  it("matches a table name as a whole word, ignores comments, and skips a dataframe nobody provides", () => {
    const tricky = [
      sql("o", "select 1", "orders"),
      sql("x", "select * from orders_archive -- from orders", "x"),
      chart("c", "nobody"),
    ];
    expect(relatedCellIds(tricky, "x", "upstream")).toEqual(["x"]);
    expect(relatedCellIds(tricky, "c", "both")).toEqual(["c"]);
  });
});

describe("relatedCellIds with the sql_literal template filter", () => {
  it("ties an input to the query that reads it as sql_literal, in both directions", () => {
    const literal = [
      input("pick", "selected_borough"),
      sql(
        "q",
        "SELECT * FROM t WHERE boroname = {{ selected_borough | sql_literal }}",
        "q",
      ),
      sql("other", "select 1", "other"),
    ];
    expect(relatedCellIds(literal, "q", "upstream")).toEqual(["pick", "q"]);
    expect(relatedCellIds(literal, "pick", "downstream")).toEqual([
      "pick",
      "q",
    ]);
    expect(relatedCellIds(literal, "other", "both")).toEqual(["other"]);
  });
});
