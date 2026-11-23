import { beforeEach, expect, it, vi } from "vitest";

import { SAMPLE_DATA_SOURCE_ID } from "../shared/sample-data-contract.js";

const state = vi.hoisted(() => ({
  project: vi.fn(),
  document: vi.fn(),
  allowed: vi.fn(),
  execute: vi.fn(),
  dataframe: vi.fn(),
  outputs: vi.fn(),
}));
vi.mock("../server/lib/project-action-access.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/project-action-access.js")
  >()),
  requireReadableProject: state.project,
}));
vi.mock("../server/model/projects-store.js", () => ({
  getReadableProjectDocument: state.document,
}));
vi.mock("../server/model/dataframe-execution.js", () => ({
  runPublishedDataframe: state.dataframe,
}));
vi.mock("../server/model/data-connections.js", async () => ({
  isBuiltinSampleConnection: (
    await import("../server/model/data-connection-dto.js")
  ).isBuiltinSampleConnection,
  canReadConnectionResults: state.allowed,
  executeConnectionQuery: state.execute,
}));
vi.mock("../server/model/project-output-access.js", () => ({
  readAccessibleProjectOutputs: state.outputs,
}));
import { compileSqlTemplate } from "../server/model/sql-template.js";
import action from "./run-published-project-cell.js";

beforeEach(() => {
  vi.resetAllMocks();
  state.project.mockResolvedValue({
    scope: { ownerEmail: "reader@example.invalid", orgId: "org" },
    project: { id: "p" },
  });
  state.document.mockResolvedValue({
    publishedVersionId: "v",
    cells: [
      {
        id: "input",
        contents: {
          kind: "input",
          name: "choice",
          inputType: "DROPDOWN",
          defaultValueString: "ok",
          options: ["ok", "other"],
        },
      },
      {
        id: "sql",
        contents: {
          kind: "sql",
          source: "SELECT '{{choice}}' AS value",
          dataConnectionId: "conn",
        },
      },
    ],
  });
  state.allowed.mockResolvedValue(true);
  state.execute.mockResolvedValue({
    jobComplete: true,
    columns: [{ name: "value", type: "STRING" }],
    rows: [["other"]],
    hasNextPage: false,
  });
});

it("binds published input values and returns viewer-local output", async () => {
  const result = await action.run(
    {
      projectId: "p",
      version: "v",
      cellId: "sql",
      values: { choice: "other" },
    },
    { caller: "frontend" } as never,
  );
  expect(state.document).toHaveBeenCalledWith(
    expect.anything(),
    "p",
    "v",
    "published",
  );
  expect(state.execute).toHaveBeenCalledWith(
    expect.objectContaining({
      query: "SELECT @template_0 AS value",
      parameters: [
        expect.objectContaining({ parameterValue: { value: "other" } }),
      ],
    }),
    expect.anything(),
  );
  expect(result.output).toMatchObject({ type: "table", rows: [["other"]] });
});

it("rejects the direct SQL path for an immutable release before dispatching", async () => {
  state.document.mockResolvedValue({
    publishedVersionId: "v",
    publishedHead: { versionId: "working", revision: "1" },
    cells: [
      {
        id: "sql",
        contents: {
          kind: "sql",
          source: "SELECT 'other' AS value",
          dataConnectionId: "conn",
        },
      },
    ],
  });
  await expect(
    action.run(
      { projectId: "p", version: "latest", cellId: "sql", values: {} },
      { caller: "frontend" } as never,
    ),
  ).rejects.toMatchObject({ errorCode: "app_session_required" });
  expect(state.execute).not.toHaveBeenCalled();
});

it.each([null, SAMPLE_DATA_SOURCE_ID])(
  "runs a published sample query on source %s with its viewer input",
  async (dataConnectionId) => {
    state.document.mockResolvedValue({
      publishedVersionId: "v",
      cells: [
        {
          id: "input",
          contents: {
            kind: "input",
            name: "min_total",
            inputType: "TEXT",
            defaultValueString: "100",
          },
        },
        {
          id: "sql",
          contents: {
            kind: "sql",
            source:
              "SELECT COUNT(*) AS count FROM orders WHERE order_total >= {{ min_total }}",
            dataConnectionId,
          },
        },
      ],
    });
    const input = { projectId: "p", version: "latest", cellId: "sql" };
    const result = await action.run(
      { ...input, values: { min_total: "99999999" } },
      { caller: "frontend" } as never,
    );
    expect(result.output).toMatchObject({ type: "table", rows: [[0]] });
    expect(state.execute).not.toHaveBeenCalled();
  },
);

it.each([
  "SELECT {{ missing_input }} AS value",
  "SELECT {{ Input 1 }} AS value",
])("reports a typed input failure for %s", async (source) => {
  state.document.mockResolvedValue({
    publishedVersionId: "v",
    cells: [
      {
        id: "sql",
        contents: { kind: "sql", source, dataConnectionId: "conn" },
      },
    ],
  });
  await expect(
    action.run({ projectId: "p", version: "v", cellId: "sql", values: {} }, {
      caller: "frontend",
    } as never),
  ).rejects.toMatchObject({
    statusCode: 422,
    errorCode: "project_input_invalid",
  });
  expect(state.execute).not.toHaveBeenCalled();
});

it("runs a warehouse-derived dataframe from the pinned published version", async () => {
  state.document.mockResolvedValue({
    id: "p",
    publishedVersionId: "v",
    cells: [
      {
        id: "source",
        contents: {
          kind: "sql",
          source: "SELECT order_total FROM orders",
          dataConnectionId: "conn",
          resultVariable: "warehouse_frame",
        },
      },
      {
        id: "sql",
        contents: {
          kind: "sql",
          source: "SELECT COUNT(*) FROM warehouse_frame",
          dataConnectionId: null,
          connectionMode: "dataframes",
        },
      },
    ],
  });
  const table = {
    type: "table",
    columns: [{ name: "count", type: "number" }],
    rows: [[42]],
    rowCount: 1,
    truncated: false,
  };
  state.dataframe.mockResolvedValueOnce(table);
  await expect(
    action.run({ projectId: "p", version: "v", cellId: "sql", values: {} }, {
      caller: "frontend",
    } as never),
  ).resolves.toEqual({ output: table });
  expect(state.dataframe).toHaveBeenCalledExactlyOnceWith(
    {
      ownerEmail: "reader@example.invalid",
      orgId: "org",
      caller: "frontend",
    },
    {
      projectId: "p",
      versionId: "v",
      cellId: "sql",
      values: {},
    },
  );
  expect(state.execute).not.toHaveBeenCalled();
});

it("report SAYA-1117-INPUT-DOCS-ARRAY binds a multiselect array in published SQL", async () => {
  state.document.mockResolvedValue({
    publishedVersionId: "v",
    cells: [
      {
        id: "input",
        contents: {
          kind: "input",
          name: "regions",
          inputType: "MULTISELECT",
          defaultValueString: "[]",
          options: ["east", "west' OR true --"],
        },
      },
      {
        id: "sql",
        contents: {
          kind: "sql",
          source: "SELECT * FROM sales WHERE region IN ({{ regions | array }})",
          dataConnectionId: "conn",
        },
      },
    ],
  });
  await action.run(
    {
      projectId: "p",
      version: "v",
      cellId: "sql",
      values: { regions: ["east", "west' OR true --"] },
    },
    { caller: "frontend" } as never,
  );
  expect(state.execute).toHaveBeenCalledWith(
    expect.objectContaining({
      query: "SELECT * FROM sales WHERE region IN (@template_0, @template_1)",
      parameters: [
        expect.objectContaining({ parameterValue: { value: "east" } }),
        expect.objectContaining({
          parameterValue: { value: "west' OR true --" },
        }),
      ],
    }),
    { userEmail: "reader@example.invalid", orgId: "org", caller: "frontend" },
  );
});

it("retains legacy list syntax and rejects malformed or empty arrays", () => {
  expect(
    compileSqlTemplate("x IN ({{regions:list}})", { regions: ["east"] }).sql,
  ).toBe("x IN (@template_0)");
  expect(() =>
    compileSqlTemplate("x IN ({{regions | array}})", { regions: [] }),
  ).toThrow();
  expect(() =>
    compileSqlTemplate("x IN ({{regions | array}})", { regions: "east" }),
  ).toThrow();
  expect(() =>
    compileSqlTemplate("x IN ({{regions | other}})", { regions: ["east"] }),
  ).toThrow();
});

it("report A2-PUBLISHED-READ-TYPE-NARROWING preserves defaults for omitted inputs", async () => {
  await action.run(
    { projectId: "p", version: "v", cellId: "sql", values: {} },
    { caller: "frontend" } as never,
  );
  expect(state.execute).toHaveBeenCalledWith(
    expect.objectContaining({
      parameters: [
        expect.objectContaining({ parameterValue: { value: "ok" } }),
      ],
    }),
    expect.anything(),
  );
});

it("denies inaccessible connections and invalid choices before execution", async () => {
  state.allowed.mockResolvedValueOnce(false);
  await expect(
    action.run(
      { projectId: "p", version: "v", cellId: "sql", values: {} },
      {} as never,
    ),
  ).rejects.toMatchObject({ errorCode: "data_connection_forbidden" });
  await expect(
    action.run(
      {
        projectId: "p",
        version: "v",
        cellId: "sql",
        values: { choice: "injected" },
      },
      {} as never,
    ),
  ).rejects.toMatchObject({ errorCode: "project_input_invalid" });
  expect(state.execute).not.toHaveBeenCalled();
});

it("refuses an unavailable published version", async () => {
  state.document.mockResolvedValue(null);
  await expect(
    action.run(
      { projectId: "p", version: "working", cellId: "sql", values: {} },
      {} as never,
    ),
  ).rejects.toMatchObject({ errorCode: "project_version_not_found" });
  expect(state.execute).not.toHaveBeenCalled();
});

it("decodes BigQuery numeric strings and rejects unsafe integer results", async () => {
  state.execute.mockResolvedValue({
    jobComplete: true,
    columns: [{ name: "count", type: "INTEGER" }],
    rows: [["42"]],
    hasNextPage: false,
  });
  const input = { projectId: "p", version: "v", cellId: "sql", values: {} };
  expect((await action.run(input, {} as never)).output).toMatchObject({
    rows: [[42]],
  });
  state.execute.mockResolvedValue({
    jobComplete: true,
    columns: [{ name: "count", type: "INTEGER" }],
    rows: [["9007199254740993"]],
    hasNextPage: false,
  });
  await expect(action.run(input, {} as never)).rejects.toMatchObject({
    errorCode: "warehouse_query_value_unreadable",
    statusCode: 424,
  });
});

it("uses only a published chart's saved drilldown and binds the clicked point", async () => {
  state.document.mockResolvedValue({
    publishedVersionId: "v",
    cells: [
      {
        id: "source",
        contents: {
          kind: "sql",
          source: "SELECT 1",
          dataConnectionId: "conn",
          resultVariable: "frame",
        },
      },
      {
        id: "chart",
        contents: {
          kind: "chart",
          dataframe: "frame",
          drilldownSql: "SELECT '{{drillX}}' AS value",
        },
      },
    ],
  });
  await action.run(
    {
      projectId: "p",
      version: "v",
      cellId: "chart",
      values: {},
      point: { x: "' OR TRUE --", series: "" },
    },
    { caller: "frontend" } as never,
  );
  expect(state.execute).toHaveBeenCalledWith(
    expect.objectContaining({
      query: "SELECT @template_0 AS value",
      parameters: [
        expect.objectContaining({ parameterValue: { value: "' OR TRUE --" } }),
      ],
    }),
    expect.anything(),
  );
});

it("report A2-PUBLISHED-SCALAR-ARRAY: rejects array values for scalar controls before querying", async () => {
  await expect(
    action.run(
      {
        projectId: "p",
        version: "v",
        cellId: "sql",
        values: { choice: ["ok", "other"] },
      },
      {} as never,
    ),
  ).rejects.toMatchObject({ errorCode: "project_input_invalid" });
  expect(state.execute).not.toHaveBeenCalled();
});

const dynamicDocument = () => ({
  id: "p",
  publishedVersionId: "v",
  cells: [
    {
      id: "src",
      contents: {
        kind: "sql",
        source: "SELECT n FROM numbers",
        dataConnectionId: "conn",
        resultVariable: "numbers",
      },
    },
    {
      id: "input",
      contents: {
        kind: "input",
        name: "n",
        inputType: "DROPDOWN",
        defaultValueString: "",
        options: ["static"],
        optionsSource: { dataframe: "numbers", valueColumn: "n" },
      },
    },
    {
      id: "sql",
      contents: {
        kind: "sql",
        source: "SELECT '{{ n }}' AS value",
        dataConnectionId: "conn",
      },
    },
  ],
});
const sourceRecord = (output: unknown, status = "complete") => ({
  src: { status, output, ranAt: "t", sourceConnectionId: "conn" },
});
const numbers = (truncated = false) => ({
  type: "table",
  columns: [{ name: "n", type: "number" }],
  rows: [[7], [8]],
  rowCount: 2,
  truncated,
});
const runDynamic = (value: string) =>
  action.run(
    { projectId: "p", version: "v", cellId: "sql", values: { n: value } },
    { caller: "frontend" } as never,
  );

it("validates a query-driven choice against the pinned version's complete source result and binds it typed", async () => {
  state.document.mockResolvedValue(dynamicDocument());
  state.outputs.mockResolvedValue(sourceRecord(numbers()));
  await runDynamic("7");
  expect(state.outputs).toHaveBeenCalledWith(
    { ownerEmail: "reader@example.invalid", orgId: "org" },
    "p",
    "v",
    new Set(["src"]),
    // The caller reaches the transitive access check on the source's lineage.
    "frontend",
  );
  expect(state.execute).toHaveBeenCalledWith(
    expect.objectContaining({
      parameters: [
        expect.objectContaining({
          parameterType: { type: "INT64" },
          parameterValue: { value: "7" },
        }),
      ],
    }),
    expect.anything(),
  );
});

it("refuses a value outside the source result, including the old typed list", async () => {
  state.document.mockResolvedValue(dynamicDocument());
  state.outputs.mockResolvedValue(sourceRecord(numbers()));
  await expect(runDynamic("static")).rejects.toMatchObject({
    errorCode: "project_input_invalid",
  });
  await expect(runDynamic("9")).rejects.toMatchObject({
    errorCode: "project_input_invalid",
  });
  expect(state.execute).not.toHaveBeenCalled();
});

it("does not run or leak choices when the source result is not readable or not complete", async () => {
  state.document.mockResolvedValue(dynamicDocument());
  state.outputs.mockResolvedValue(
    sourceRecord(
      { type: "error", message: "no access", detail: null },
      "error",
    ),
  );
  await expect(runDynamic("7")).rejects.toMatchObject({
    errorCode: "project_input_options_source_unavailable",
  });
  state.outputs.mockResolvedValue(sourceRecord(numbers(true)));
  await expect(runDynamic("7")).rejects.toMatchObject({
    errorCode: "project_input_options_incomplete",
  });
  state.outputs.mockResolvedValue({});
  await expect(runDynamic("7")).rejects.toMatchObject({
    errorCode: "project_input_options_pending",
  });
  expect(state.execute).not.toHaveBeenCalled();
});

it("report ASK84-PUBLISHED-PANEL-ROWS reads every result page for a published panel", async () => {
  const job = { projectId: "proj", jobId: "job" };
  const page = (start: number, count: number, pageToken: string | null) => ({
    jobComplete: true,
    jobReference: job,
    columns: [{ name: "n", type: "INTEGER" }],
    rows: Array.from({ length: count }, (_, i) => [String(start + i)]),
    pageToken,
    hasNextPage: pageToken !== null,
  });
  state.execute
    .mockResolvedValueOnce(page(0, 1000, "p2"))
    .mockResolvedValueOnce(page(1000, 202, null));
  const { output } = await action.run(
    { projectId: "p", version: "v", cellId: "sql", values: {} },
    { caller: "frontend" } as never,
  );
  expect(output).toMatchObject({ rowCount: 1202, truncated: false });
  expect(output.type === "table" && output.rows.at(-1)).toEqual([1201]);
  expect(state.execute).toHaveBeenLastCalledWith(
    { connectionId: "conn", job, pageToken: "p2", first: 1000 },
    expect.objectContaining({ caller: "frontend" }),
  );
});

it("report ASK84-PUBLISHED-PANEL-ROWS stops at the published row bound and marks truncation", async () => {
  const job = { projectId: "proj", jobId: "job" };
  let served = 0;
  state.execute.mockImplementation(async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => [String(served + i)]);
    served += 1000;
    return {
      jobComplete: true,
      jobReference: job,
      columns: [{ name: "n", type: "INTEGER" }],
      rows,
      pageToken: `page-${served}`,
      hasNextPage: true,
    };
  });
  const { output } = await action.run(
    { projectId: "p", version: "v", cellId: "sql", values: {} },
    { caller: "frontend" } as never,
  );
  expect(output).toMatchObject({ rowCount: 10_000, truncated: true });
  expect(state.execute).toHaveBeenCalledTimes(10);
});

it("report ASK84-PUBLISHED-PANEL-ROWS refuses a repeated page token", async () => {
  const job = { projectId: "proj", jobId: "job" };
  state.execute.mockResolvedValue({
    jobComplete: true,
    jobReference: job,
    columns: [{ name: "n", type: "INTEGER" }],
    rows: [["1"]],
    pageToken: "same",
    hasNextPage: true,
  });
  await expect(
    action.run({ projectId: "p", version: "v", cellId: "sql", values: {} }, {
      caller: "frontend",
    } as never),
  ).rejects.toMatchObject({ errorCode: "warehouse_query_page_invalid" });
});

// oracle-change: an invalid SQL template is now reported as the typed project_input_invalid failure (422), as in "reports a typed input failure", not a separate project_sql_template_invalid 400
it("does not recast provider failures as invalid templates", async () => {
  const error = new Error("provider failed");
  state.execute.mockRejectedValue(error);
  await expect(
    action.run(
      { projectId: "p", version: "v", cellId: "sql", values: {} },
      {} as never,
    ),
  ).rejects.toBe(error);
});
