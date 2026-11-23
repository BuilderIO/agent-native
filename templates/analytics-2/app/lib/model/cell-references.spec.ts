import { describe, expect, it } from "vitest";

import {
  cellInputParams,
  cellOutputParams,
  inputNameToLabel,
  resolveCellLabel,
  resolveCellReferences,
  unresolvedInputParams,
} from "./cell-references.js";
import type { CellContents } from "./contracts.js";

const base = {
  id: "cell",
  order: "i",
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
};

function sql(
  id: string,
  fields: Partial<Extract<CellContents, { kind: "sql" }>> = {},
) {
  return {
    ...base,
    kind: "sql" as const,
    id,
    source: "select 1",
    dataConnectionId: null,
    databaseSchema: null,
    resultVariable: null,
    outputResult: true,
    ...fields,
  } satisfies CellContents;
}

function displayTable(
  id: string,
  dataframe: string | null,
  columns: string[] = [],
): CellContents {
  return {
    ...base,
    id,
    kind: "display-table",
    dataframe,
    columns: columns.map((name) => ({
      name,
      header: null,
      format: null,
      hidden: false,
    })),
  };
}

describe("cell labels", () => {
  it("counts from one and uses the kind noun", () => {
    expect(resolveCellLabel({ contents: sql("a"), label: null }, 0)).toBe(
      "SQL 1",
    );
    expect(
      resolveCellLabel({ contents: displayTable("t", null), label: null }, 4),
    ).toBe("Table 5");
    expect(
      resolveCellLabel(
        { contents: { ...base, kind: "markdown", markdown: "" }, label: null },
        1,
      ),
    ).toBe("Markdown 2");
  });

  it("keeps a label the person typed", () => {
    expect(resolveCellLabel({ contents: sql("a"), label: "Revenue" }, 3)).toBe(
      "Revenue",
    );
    expect(resolveCellLabel({ contents: sql("a"), label: "  " }, 3)).toBe(
      "SQL 4",
    );
  });

  it("names inputs after their variable name", () => {
    const input: CellContents = {
      ...base,
      kind: "input",
      name: "order_total",
      inputType: "NUMERIC_INPUT",
      defaultValueString: "0",
    };
    expect(resolveCellLabel({ contents: input, label: null }, 0)).toBe(
      "Order total",
    );
    expect(inputNameToLabel("already_spaced name")).toBe("Already spaced name");
    expect(inputNameToLabel("")).toBe("");
  });

  it("falls back to a generic label without a cell", () => {
    expect(resolveCellLabel(null, 2)).toBe("Cell 3");
  });
});

describe("cell variables", () => {
  it("reads the dataframe a visualization points at", () => {
    expect(cellInputParams(displayTable("t", "orders", ["total"]))).toEqual([
      "orders",
      "total",
    ]);
    expect(
      cellInputParams({
        ...base,
        kind: "chart",
        dataframe: "orders",
        chartSpec: {
          mark: "bar",
          xField: null,
          yField: null,
          seriesField: null,
          title: null,
        },
      }),
    ).toEqual(["orders"]);
    expect(
      cellInputParams({
        ...base,
        kind: "map",
        layers: [
          { type: "dataset", dataframeName: "orders" },
          { type: "scatter", dataframeName: "orders" },
          { type: "area", dataframeName: null },
        ],
      }),
    ).toEqual(["orders"]);
  });

  it("produces the result a cell exposes unless it hides it", () => {
    expect(cellOutputParams(sql("a", { resultVariable: "orders" }))).toEqual([
      "orders",
    ]);
    expect(
      cellOutputParams(
        sql("a", { resultVariable: "orders", outputResult: false }),
      ),
    ).toEqual([]);
    expect(
      cellOutputParams({
        ...base,
        kind: "input",
        name: "region",
        inputType: "DROPDOWN",
        defaultValueString: "",
      }),
    ).toEqual(["region"]);
    expect(cellOutputParams(displayTable("t", "orders"))).toEqual([]);
  });

  it("links a reader to the nearest producer above it", () => {
    const cells = [
      { id: "one", contents: sql("one", { resultVariable: "orders" }) },
      { id: "two", contents: displayTable("two", "orders") },
      { id: "three", contents: sql("three", { resultVariable: "orders" }) },
      { id: "four", contents: displayTable("four", "orders") },
    ];
    expect(resolveCellReferences(cells)).toEqual([
      { cellId: "one", param: "orders" },
      { cellId: "three", param: "orders" },
    ]);
  });

  it("reports names nothing above produces", () => {
    expect(
      unresolvedInputParams([
        { id: "a", contents: sql("a", { resultVariable: "orders" }) },
        { id: "b", contents: displayTable("b", "orders") },
        { id: "c", contents: displayTable("c", "customers") },
      ]),
    ).toEqual(["customers"]);
    expect(
      unresolvedInputParams([
        { id: "a", contents: displayTable("a", "orders") },
        { id: "b", contents: sql("b", { resultVariable: "orders" }) },
      ]),
    ).toEqual(["orders"]);
  });

  it("ignores inline JSON chart dataframes as external dataframe references", () => {
    const inlineChart: CellContents = {
      ...base,
      kind: "chart",
      dataframe: '[{"stage":"visit","sum_users":14488}]',
      chartSpec: {
        mark: "bar",
        xField: "stage",
        yField: "sum_users",
        seriesField: null,
        title: "Users by stage",
      },
    };
    expect(cellInputParams(inlineChart)).toEqual([]);
    expect(
      unresolvedInputParams([{ id: "chart", contents: inlineChart }]),
    ).toEqual([]);
  });
});
