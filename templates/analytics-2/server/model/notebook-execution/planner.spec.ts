import { describe, expect, it } from "vitest";

import {
  codeCellContentsSchema,
  sqlCellContentsSchema,
} from "../../../app/lib/model/contracts.js";
import { runRequestSchema } from "../../../shared/notebook-execution.js";
import { completeResultManifestSchema } from "../../../shared/notebook-result-contract.js";
import { notebookCellIdSchema } from "../../../shared/notebook-snapshot-contract.js";
import {
  notebookGraph,
  planRun,
  type AvailableResult,
  type CellId,
  type ExecutionCell,
} from "./planner.js";

function sqlCell(
  id: string,
  source: string,
  resultVariable: string,
  connection?: string,
): ExecutionCell {
  return {
    id: notebookCellIdSchema.parse(id),
    contents: sqlCellContentsSchema.parse({
      kind: "sql",
      id,
      order: "i",
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      source,
      resultVariable,
      outputResult: true,
      databaseSchema: null,
      dataConnectionId: connection ?? null,
      ...(connection ? {} : { connectionMode: "dataframes" }),
    }),
  };
}

const ref = {
  workspaceId: "workspace",
  projectId: "project",
  head: { versionId: "draft", revision: "4" },
  eventSeq: "4",
};
function request(mode: string, cell = "d") {
  return runRequestSchema.parse({
    mode,
    requestId: "request",
    cache: "reuse",
    snapshot: {
      ref,
      namespace: { kind: "draft", namespaceId: "draft-namespace" },
      inputRevision: "0",
      executionFingerprint: "hash",
    },
    ...(mode === "run-all"
      ? { restart: false }
      : { targetCellId: cell, staleValues: "reject" }),
  });
}

function existing(cellId: string, fresh: boolean, compatible = true) {
  return [
    notebookCellIdSchema.parse(cellId),
    {
      fresh,
      compatible,
      manifest: completeResultManifestSchema.parse({
        status: "complete-empty",
        rowCount: "0",
        fields: [],
        result: {
          resultId: `result-${cellId}`,
          snapshot: ref,
          producer: {
            cellId,
            namespaceId: "draft-namespace",
            runId: "old",
            attemptId: "attempt",
            outputGeneration: "0",
            exportId: "result",
          },
          dependencyFingerprint: "digest",
          inputRevision: "0",
          kernelGeneration: null,
          sourceGeneration: null,
        },
      }),
    },
  ] as const;
}
const graph = notebookGraph([
  sqlCell("a", "select 42", "alpha"),
  sqlCell("b", "select * from alpha", "beta"),
  sqlCell("c", "select * from alpha", "gamma"),
  sqlCell("d", "select * from beta join gamma on true", "delta"),
  sqlCell("e", "select 84", "unrelated"),
]);

describe("notebook planner", () => {
  const available = new Map<CellId, AvailableResult>([
    existing("b", true),
    existing("c", true),
  ]);
  it.each([
    ["cell-only", "d", ["d"], ["result-b", "result-c"]],
    ["upstream", "d", ["a", "b", "c", "d"], []],
    ["downstream", "b", [], []],
    ["auto", "b", ["a", "b", "d"], ["result-c"]],
    ["run-all", "d", ["a", "b", "c", "d", "e"], []],
  ] as const)(
    "plans %s with notebook-order ties and exact prerequisite IDs",
    (mode, cell, admitted, ids) => {
      const plan = planRun(graph, request(mode, cell), available).projection;
      expect(plan.admittedCellIds).toEqual(admitted);
      expect(plan.dependencyResultIds).toEqual(ids);
    },
  );

  it("runs executable descendants of a collapsed section with external prerequisites and leaves other cells alone", () => {
    function child(
      id: string,
      source: string,
      result: string,
      parentSectionId: string,
    ) {
      const cell = sqlCell(id, source, result);
      return { ...cell, contents: { ...cell.contents, parentSectionId } };
    }
    const nestedGraph = notebookGraph([
      sqlCell("source", "select 42", "source_result"),
      child("join", "select * from source_result", "joined", "inner"),
      child("broken", "select (", "broken_result", "inner"),
      child(
        "derived",
        "select * from broken_result",
        "derived_result",
        "outer",
      ),
      sqlCell("outside", "select * from joined", "outside_result"),
    ]);
    const target = request("run-section", "outer");
    const sectionCells = [
      { id: "outer", contents: { kind: "collapsible", collapsed: true } },
      {
        id: "inner",
        contents: {
          kind: "collapsible",
          collapsed: true,
          parentSectionId: "outer",
        },
      },
    ] as const;
    const plan = (results: ReadonlyMap<CellId, AvailableResult>) =>
      planRun(nestedGraph, target, results, { sectionCells }).projection;

    expect(plan(new Map())).toEqual({
      admittedCellIds: ["source", "join"],
      dependencyResultIds: [],
      rejectedCells: [
        { cellId: "broken", reason: "parse_error" },
        { cellId: "derived", reason: "incompatible_prerequisite" },
      ],
    });
    expect(plan(new Map([existing("source", true)]))).toMatchObject({
      admittedCellIds: ["join"],
      dependencyResultIds: ["result-source"],
    });
    expect(
      planRun(nestedGraph, request("run-section", "outside"), new Map(), {
        sectionCells,
      }).projection,
    ).toEqual({
      admittedCellIds: [],
      dependencyResultIds: [],
      rejectedCells: [{ cellId: "outside", reason: "missing_prerequisite" }],
    });
  });

  it("blocks downstream when an external prerequisite is absent, incompatible, or its upstream cannot run", () => {
    const missing = planRun(
      graph,
      request("downstream", "b"),
      new Map(),
    ).projection;
    expect(missing.rejectedCells).toEqual([
      { cellId: "b", reason: "missing_prerequisite" },
      { cellId: "d", reason: "incompatible_prerequisite" },
    ]);
    const unavailable = new Map([
      existing("a", true),
      existing("c", true, false),
    ]);
    expect(
      planRun(graph, request("downstream", "b"), unavailable).projection,
    ).toMatchObject({
      admittedCellIds: ["b"],
      rejectedCells: [{ cellId: "d", reason: "incompatible_prerequisite" }],
    });
    const compatible = new Map([existing("a", false), existing("c", true)]);
    expect(
      planRun(
        graph,
        runRequestSchema.parse({
          ...request("downstream", "b"),
          staleValues: "allow-compatible",
        }),
        compatible,
      ).projection.admittedCellIds,
    ).toEqual(["b", "d"]);
  });

  it("resolves the nearest prior definition again after reorder and rejects forward dataframe references", () => {
    const first = sqlCell("first", "select 42", "alpha");
    const second = sqlCell("second", "select 84", "alpha");
    const use = sqlCell("use", "select * from alpha", "beta");
    const planned = (cells: ExecutionCell[]) =>
      planRun(notebookGraph(cells), request("upstream", "use"), new Map())
        .projection;
    expect(planned([first, second, use]).admittedCellIds).toEqual([
      "second",
      "use",
    ]);
    expect(planned([first, use, second]).admittedCellIds).toEqual([
      "first",
      "use",
    ]);
    expect(planned([use, first, second]).rejectedCells).toEqual([
      { cellId: "use", reason: "missing_prerequisite" },
    ]);
  });

  it("keeps scoped CTEs and qualified warehouse names distinct from eligible notebook relations", () => {
    const alpha = sqlCell("a", "select 42", "alpha", "warehouse");
    const wrong = sqlCell("wrong", "select 84", "alpha", "other");
    const relation = sqlCell(
      "relation",
      "select * from alpha",
      "relation",
      "warehouse",
    );
    const cte = sqlCell(
      "cte",
      "with alpha as (select 9) select * from alpha",
      "cte",
      "warehouse",
    );
    const physical = sqlCell(
      "physical",
      "select * from `test.data.alpha`",
      "physical",
      "warehouse",
    );
    const planned = notebookGraph([alpha, wrong, relation, cte, physical]);
    expect(
      planned.map((node) => node.dependencies.map(({ cellId }) => cellId)),
    ).toEqual([[], [], ["a"], [], []]);
  });

  it("resolves case-sensitive Python imports, reassignments and function globals", () => {
    const code = (id: string, source: string): ExecutionCell => ({
      id: notebookCellIdSchema.parse(id),
      contents: codeCellContentsSchema.parse({
        ...sqlCell(id, "", "").contents,
        kind: "code",
        language: "python",
        source,
        resultVariable: null,
      }),
    });
    const graph = notebookGraph([
      code("first", "value = 42\nScale = 2"),
      code("module", "import pandas as pd"),
      code("Function", "def f(value):\n    return value * Scale"),
      code("next", "value = value + 1\npd.DataFrame({'n': [f(value)]})\nscale"),
      code("dynamic", '# inputs: Scale\nglobals()["Scale"]'),
    ]);
    expect(
      graph.map(({ dependencies }) =>
        dependencies.map(({ name, cellId }) => [name, cellId]),
      ),
    ).toEqual([
      [],
      [],
      [["Scale", "first"]],
      [
        ["value", "first"],
        ["pd", "module"],
        ["f", "Function"],
      ],
      [["Scale", "first"]],
    ]);
  });

  it("reports a parse error and blocks its descendants without losing independent work", () => {
    const broken = notebookGraph([
      sqlCell("a", "select (", "alpha"),
      sqlCell("b", "select * from alpha", "beta"),
      sqlCell("c", "select 84", "independent"),
    ]);
    expect(planRun(broken, request("run-all"), new Map()).projection).toEqual({
      admittedCellIds: ["c"],
      dependencyResultIds: [],
      rejectedCells: [
        { cellId: "a", reason: "parse_error" },
        { cellId: "b", reason: "incompatible_prerequisite" },
      ],
    });
  });

  it("rejects empty and whitespace-only SQL cells with parse_error", () => {
    const emptyGraph = notebookGraph([
      sqlCell("empty", "", "alpha"),
      sqlCell("whitespace", "   \n\t  ", "beta"),
      sqlCell("valid", "select 1", "gamma"),
    ]);
    expect(
      planRun(emptyGraph, request("run-all"), new Map()).projection,
    ).toEqual({
      admittedCellIds: ["valid"],
      dependencyResultIds: [],
      rejectedCells: [
        { cellId: "empty", reason: "parse_error" },
        { cellId: "whitespace", reason: "parse_error" },
      ],
    });
  });
  it("accepts a qualified star in a warehouse cell", () => {
    const graph = notebookGraph([
      sqlCell(
        "a",
        "with e as (select 1 as x) select e.*, 2 as y from e",
        "alpha",
      ),
    ]);
    expect(graph[0]?.problem).toBeUndefined();
  });
  it("accepts BigQuery pivot, unpivot, offset, wildcard and sample syntax in a warehouse cell", () => {
    const graph = notebookGraph(
      [
        "select * from (select product, quarter, sales from `p.d.s`) pivot(sum(sales) for quarter in ('Q1', 'Q2'))",
        "select * from `p.d.s` unpivot(sales for quarter in (q1, q2))",
        "select x, off from `p.d.t`, unnest(arr) as x with offset as off",
        "select count(*) from `p.d.events_*` where _table_suffix between '20260101' and '20260131'",
        "select * from `p.d.t` tablesample system (10 percent)",
      ].map((source, index) =>
        sqlCell(`c${index}`, source, `r${index}`, "warehouse"),
      ),
    );
    expect(graph.map(({ problem }) => problem)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("includes transitive dependencies and input cells in the planned cells list", () => {
    const inputCell: ExecutionCell = {
      id: notebookCellIdSchema.parse("in"),
      contents: {
        kind: "input",
        id: "in",
        order: "a",
        label: "Threshold",
        hidden: false,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
        name: "threshold",
        inputType: "NUMERIC_INPUT",
        defaultValueString: "10",
        optional: false,
      },
    };
    const c1 = sqlCell("c1", "select {{ threshold }} as val", "step1");
    const c2 = sqlCell("c2", "select * from step1", "step2");
    const c3 = sqlCell("c3", "select * from step2", "step3");
    const g = notebookGraph([inputCell, c1, c2, c3]);
    const plan = planRun(
      g,
      request("cell-only", "c3"),
      new Map([existing("c2", true)]),
    );
    expect(plan.cells.map(({ cell }) => cell.id)).toEqual([
      "in",
      "c1",
      "c2",
      "c3",
    ]);
  });
});
