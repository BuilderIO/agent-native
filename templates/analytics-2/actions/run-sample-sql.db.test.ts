// The daily-flow P0: a new workspace's sample project must be able to run its own
// SQL with no warehouse connection. This drives the real action against a real
// PGlite database, the same way the app does.
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  appMemberRoles,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import {
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
  type PrivateBlobProvider,
} from "@agent-native/core/private-blob";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  chartSeriesFrom,
  resolveChartDataframe,
} from "../app/components/notebook/chart-config.js";
import { unresolvedInputParams } from "../app/lib/model/cell-references.js";
import { localDuckDb } from "../server/execution/local-duckdb.test-support.js";
import { createNotebookWorker } from "../server/execution/notebook-worker.js";
import { updateCell } from "../server/model/cells-store.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { seedLegacyPublishedProject } from "../server/model/legacy-published-fixture.test-support.js";
import { notebookRunStore } from "../server/model/notebook-execution/service.js";
import {
  createProject,
  getProjectDocument,
} from "../server/model/projects-store.js";
import { clearCellOutput, readCellOutput } from "../server/model/runs-store.js";
import { ensureSampleWorkspace, sampleCellId } from "../server/model/seed.js";
import { runRequestSchema } from "../shared/notebook-execution.js";
import {
  notebookCellIdSchema,
  notebookProjectIdSchema,
} from "../shared/notebook-snapshot-contract.js";
import { SAMPLE_DATA_SOURCE_ID } from "../shared/sample-data-contract.js";
import addProjectCell from "./add-project-cell.js";
import createProjectAction from "./create-project.js";
import getCellExecution from "./get-notebook-cell-execution.js";
import getExecutionSnapshot from "./get-notebook-execution-snapshot.js";
import getProjectAction from "./get-project.js";
import runProjectCell from "./run-project-cell.js";
import runPublishedProjectCell from "./run-published-project-cell.js";
import saveProjectCell from "./save-project-cell.js";
import startNotebookRun from "./start-notebook-run.js";

vi.mock("../server/execution/notebook-kernel.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/execution/notebook-kernel.js")
  >()),
  createHostedKernelPort: () => localDuckDb(),
}));

const round = mkdtempSync(join(tmpdir(), "run-sample-sql-"));
const previousDatabase = process.env.DATABASE_URL;
const owner = "sample-sql-owner@example.test";
const orgId = `qa-sample-sql-${randomUUID()}`;
const context = {
  caller: "frontend" as const,
  userEmail: owner,
  orgId,
  appId: "analytics-2",
};
const asActor = <T>(call: () => T) =>
  runWithRequestContext(
    {
      userEmail: owner,
      orgId,
      authUserId: owner,
      userName: "QA sample sql",
      isSyntheticTraffic: true,
    },
    call,
  );
const blobs = new Map<string, Uint8Array>();
const storage: PrivateBlobProvider = {
  id: "sample-sql-results",
  name: "Sample SQL results",
  isConfigured: () => true,
  async put({ key, data }) {
    if (!key || blobs.has(key)) throw new Error("Invalid sample result key");
    blobs.set(key, Uint8Array.from(data));
    return { id: key, provider: this.id, encrypted: false, opaque: true };
  },
  async read(handle) {
    const data = blobs.get(handle.id);
    if (!data) throw new Error("Sample result is missing");
    return { data, handle };
  },
  async delete(handle) {
    return { deleted: blobs.delete(handle.id), provider: this.id };
  },
};

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_sample_sql_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDbExecInsert();
  registerPrivateBlobProvider(storage);
});
async function getDbExecInsert() {
  const { getDb } = await import("../server/db/index.js");
  await getDb().insert(organizations).values({
    id: orgId,
    name: "QA sample sql",
    createdBy: owner,
    createdAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId,
    email: owner,
    role: "owner",
    joinedAt: Date.now(),
  });
  await getDb().insert(appMemberRoles).values({
    id: randomUUID(),
    orgId,
    email: owner,
    appId: "analytics-2",
    role: "owner",
    updatedBy: owner,
    updatedAt: Date.now(),
  });
}

afterAll(async () => {
  unregisterPrivateBlobProvider(storage.id);
  await closeDbExec();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  const owned = resolve(round),
    temporary = resolve(tmpdir());
  if (
    owned !== temporary &&
    owned !== resolve(process.cwd()) &&
    owned.startsWith(temporary + "/run-sample-sql-")
  )
    rmSync(owned, { recursive: true, force: true });
  else throw new Error("Refused cleanup outside this test round");
});

it("shows the selected columns and query ordering in saved demo results before running them", async () => {
  const seeded = await asActor(() =>
    ensureSampleWorkspace({ ownerEmail: owner, orgId }),
  );
  for (const [index, columns] of [
    ["order_date", "order_total", "channel"],
    ["customer_name", "country", "segment"],
  ].entries()) {
    const projectId = seeded.projectIds[index];
    if (!projectId) throw new Error("Sample project was not created");
    const stored = await getProjectDocument(
      { ownerEmail: owner, orgId },
      projectId,
    );
    const sql = stored?.cells.find((cell) => cell.contents.kind === "sql");
    if (!sql || sql.contents.kind !== "sql") throw Error("Sample SQL missing");
    const { connectionSelectedAt: _unused, ...legacy } = sql.contents;
    await updateCell({
      ownerEmail: owner,
      orgId,
      projectId,
      versionId: sql.versionId,
      cellId: sql.id,
      contents: { ...legacy, dataConnectionId: null },
    });
    const { project, outputs } = await asActor(() =>
      getProjectAction.run({ projectId }, context),
    );
    expect(
      project.cells.find((cell) => cell.id === sql.id)?.contents,
    ).toMatchObject({ dataConnectionId: "builtin-sample-data" });
    for (const kind of ["sql", "display-table"]) {
      const cell = project.cells.find((item) => item.contents.kind === kind);
      const output = cell ? outputs[cell.id]?.output : undefined;
      expect(output?.type).toBe("table");
      if (output?.type !== "table") throw new Error("Sample output is missing");
      expect(output.columns.map((column) => column.name)).toEqual(columns);
      if (index === 0) {
        const dates = output.rows.map((row) => String(row[0]));
        expect(dates).toEqual([...dates].sort());
      }
    }
  }

  const funnelProjectId = seeded.projectIds[2];
  if (!funnelProjectId)
    throw new Error("Funnel sample project was not created");
  const funnelDoc = await getProjectDocument(
    { ownerEmail: owner, orgId },
    funnelProjectId,
  );
  const funnelChartId = sampleCellId(
    { ownerEmail: owner, orgId },
    "funnel",
    "chart",
  );
  const funnelChart = funnelDoc?.cells.find(
    (cell) => cell.id === funnelChartId,
  );
  if (!funnelChart || funnelChart.contents.kind !== "chart") {
    throw new Error("Funnel chart cell is missing");
  }
  await updateCell({
    ownerEmail: owner,
    orgId,
    projectId: funnelProjectId,
    versionId: funnelChart.versionId,
    cellId: funnelChart.id,
    contents: {
      ...funnelChart.contents,
      dataframe: "users_by_stage",
    },
  });
  await clearCellOutput(
    { ownerEmail: owner, orgId },
    funnelProjectId,
    funnelChart.id,
  );
  const funnelRead = await asActor(() =>
    getProjectAction.run({ projectId: funnelProjectId }, context),
  );
  const repairedChart = funnelRead.project.cells.find(
    (cell) => cell.id === funnelChartId,
  );
  expect(repairedChart?.contents.kind).toBe("chart");
  if (!repairedChart || repairedChart.contents.kind !== "chart") {
    throw new Error("Repaired funnel chart missing");
  }
  expect(repairedChart.contents.dataframe).not.toBe("users_by_stage");
  expect(funnelRead.outputs[funnelChartId]).toBeUndefined();
  const resolved = resolveChartDataframe(
    repairedChart.contents.dataframe,
    [],
    null,
  );
  expect(resolved.status).toBe("ready");
  if (resolved.status !== "ready") {
    throw new Error("Expected repaired funnel chart to resolve");
  }
  const series = chartSeriesFrom(
    repairedChart.contents.chartSpec,
    resolved.dataframe,
  );
  expect(series.columns).toEqual(["stage", "sum_users"]);
  expect(series.rows.map((row) => row[0])).toEqual([
    "visit",
    "signup",
    "activation",
    "purchase",
  ]);
  expect(
    unresolvedInputParams([
      { id: repairedChart.id, contents: repairedChart.contents },
    ]),
  ).toEqual([]);
});

describe("running a sample project's SQL without a connection", () => {
  it("cold reads the Table inserted before another query with its nearest upstream producer ID", async () => {
    const sql = {
      kind: "sql" as const,
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      source: "SELECT 1",
      dataConnectionId: "builtin-sample-data",
      databaseSchema: null,
      outputResult: true,
    };
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      cells: [
        { ...sql, resultVariable: "previous" },
        {
          kind: "display-table",
          label: "Saved table",
          hidden: false,
          gridX: null,
          gridY: null,
          gridWidth: null,
          gridHeight: null,
          dataframe: null,
          columns: [],
        },
        { ...sql, resultVariable: "after_table" },
      ],
    });
    const previous = project.cells.at(0);
    const afterTable = project.cells.at(2);
    if (!previous || !afterTable)
      throw new Error("Fixture queries are missing");
    const created = await asActor(() =>
      addProjectCell.run(
        {
          projectId: project.id,
          kind: "display-table",
          beforeCellId: afterTable.id,
        },
        context,
      ),
    );
    const read = await asActor(() =>
      getProjectAction.run({ projectId: project.id }, context),
    );
    expect(read.project.cells.map(({ contents }) => contents.kind)).toEqual([
      "sql",
      "display-table",
      "display-table",
      "sql",
    ]);
    expect(
      read.project.cells.find(({ id }) => id === created.createdCellId)
        ?.contents,
    ).toMatchObject({
      kind: "display-table",
      tableConfig: { source: { cellId: previous.id, exportId: "result" } },
    });
    expect(
      addProjectCell.schema.safeParse({
        projectId: project.id,
        kind: "writeback",
      }).success,
    ).toBe(false);
  });

  it.each([
    [
      "builtin-sample-data",
      "SELECT * FROM unknown_table",
      "project_sample_query_failed",
      /relation "unknown_table" does not exist/,
    ],
    [
      "builtin-sample-data",
      "SELECT nope_col FROM orders",
      "project_sample_query_failed",
      /column "nope_col" does not exist at \[1:8\]/,
    ],
    [
      "builtin-sample-data",
      "SELECT * FROM orders\nWHERE",
      "project_sample_query_failed",
      /syntax error at end of input at \[2:6\]/,
    ],
    [
      "builtin-sample-data",
      "SELECT * FROM orders WHERE )",
      "project_sample_query_failed",
      /syntax error at or near "\)"/,
    ],
    [
      null,
      "SELECT * FROM unknown_table",
      "project_connection_required",
      /Select a data connection/,
    ],
  ] as const)(
    "preserves the execution error for %s / %s",
    async (dataConnectionId, source, errorCode, message) => {
      const project = await createProject({
        ownerEmail: owner,
        orgId,
        cells: [
          {
            kind: "sql",
            label: null,
            hidden: false,
            gridX: null,
            gridY: null,
            gridWidth: null,
            gridHeight: null,
            source,
            dataConnectionId,
            databaseSchema: null,
            resultVariable: "dataframe",
            outputResult: true,
          },
        ],
      });
      const cell = project.cells[0];
      if (!cell) throw new Error("No SQL cell persisted");
      await expect(
        asActor(() =>
          runProjectCell.run(
            { projectId: project.id, cellId: cell.id },
            context,
          ),
        ),
      ).rejects.toMatchObject({
        errorCode,
        message: expect.stringMatching(message),
      });
      const output = await asActor(() =>
        readCellOutput({ ownerEmail: owner, orgId }, project.id, cell.id),
      );
      expect(output).toMatchObject({
        status: "error",
        output: { type: "error", message: expect.stringMatching(message) },
      });
    },
  );

  it("chains sample JOIN and GROUP BY results through dataframe SQL in the notebook and published app", async () => {
    const shared = {
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
    };
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      cells: [
        {
          ...shared,
          kind: "input",
          name: "excluded_order",
          inputType: "TEXT_INPUT",
          defaultValueString: "",
        },
        ...[
          {
            resultVariable: "joined",
            source: `SELECT o.order_id, o.customer_id, c.customer_id,
                TIMESTAMP '2026-01-01 03:00' AS ordered_at
              FROM orders o JOIN customers c ON o.customer_id = c.customer_id
              WHERE o.order_id IN ('ord_0001', 'ord_0002')
                AND o.order_id <> {{ excluded_order }}`,
            dataConnectionId: "builtin-sample-data",
          },
          {
            resultVariable: "grouped",
            source:
              "SELECT order_id, count(*) AS orders FROM orders GROUP BY order_id",
            dataConnectionId: "builtin-sample-data",
          },
          {
            resultVariable: "summed",
            source: `SELECT sum(extract(hour from j.ordered_at) * g.orders) AS total
              FROM joined j JOIN grouped g USING (order_id)
              WHERE j.customer_id = j.customer_id_2`,
            dataConnectionId: null,
            connectionMode: "dataframes" as const,
          },
          {
            resultVariable: "filtered",
            source: "SELECT total FROM summed WHERE total > 0",
            dataConnectionId: null,
            connectionMode: "dataframes" as const,
          },
          {
            resultVariable: "result",
            source: "SELECT max(total) AS total FROM filtered",
            dataConnectionId: null,
            connectionMode: "dataframes" as const,
          },
        ].map((sql) => ({
          ...shared,
          ...sql,
          kind: "sql" as const,
          databaseSchema: null,
          outputResult: true,
        })),
      ],
    });
    const result = project.cells.at(-1);
    if (!result) throw new Error("The final SQL cell is missing");
    const target = {
      projectId: notebookProjectIdSchema.parse(project.id),
      cellId: notebookCellIdSchema.parse(result.id),
    };
    const execution = await asActor(() =>
      getExecutionSnapshot.run({ projectId: target.projectId }, context),
    );
    if (execution.status !== "found") throw new Error(execution.status);
    const run = await asActor(() =>
      startNotebookRun.run(
        runRequestSchema.parse({
          requestId: randomUUID(),
          snapshot: execution.snapshot,
          mode: "run-all",
          cache: "bypass",
          restart: false,
        }),
        context,
      ),
    );
    if (run.status !== "admitted") throw new Error(run.status);
    const worker = createNotebookWorker(notebookRunStore, localDuckDb());
    for (const _cell of run.plan.admittedCellIds) {
      const worked = await asActor(() =>
        worker({ ownerEmail: owner, orgId, caller: "frontend" }, run.runId),
      );
      if (!worked) break;
    }
    const attempts = await Promise.all(
      run.plan.admittedCellIds.map((cellId) =>
        asActor(() =>
          getCellExecution.run(
            { projectId: target.projectId, cellId },
            context,
          ),
        ),
      ),
    );
    expect(
      attempts.map((attempt) =>
        attempt.status === "found"
          ? [attempt.state.status, attempt.diagnosticCode]
          : [attempt.status],
      ),
    ).toEqual(Array.from({ length: 5 }, () => ["complete", "complete"]));
    const draft = await asActor(() => runProjectCell.run(target, context));
    expect(draft.output).toMatchObject({ type: "table", rows: [[6]] });
    const saved = await asActor(() => getCellExecution.run(target, context));
    expect(saved).toMatchObject({
      status: "found",
      state: { status: "complete" },
    });

    await seedLegacyPublishedProject({ ownerEmail: owner, orgId }, project.id);
    const published = await asActor(() =>
      runPublishedProjectCell.run(
        {
          projectId: project.id,
          version: "latest",
          cellId: result.id,
          values: { excluded_order: "ord_0002" },
        },
        context,
      ),
    );
    expect(published.output).toMatchObject({ type: "table", rows: [[3]] });
    expect(await asActor(() => getCellExecution.run(target, context))).toEqual(
      saved,
    );
  });

  it("creates a sample notebook with saved runnable SQL and keeps its result after reload", async () => {
    const created = await asActor(() =>
      createProjectAction.run(
        createProjectAction.schema.parse({
          title: "QA first-run orders",
          sampleDataset: "orders",
        }),
        context,
      ),
    );
    const project = await asActor(() =>
      getProjectDocument({ ownerEmail: owner, orgId }, created.id),
    );
    expect(project?.cells).toHaveLength(1);
    const cell = project?.cells[0];
    expect(cell?.contents).toMatchObject({
      kind: "sql",
      source: "SELECT * FROM orders LIMIT 100",
      dataConnectionId: "builtin-sample-data",
      resultVariable: "orders",
    });
    if (!cell) throw new Error("No sample SQL cell was persisted");
    const result = await asActor(() =>
      runProjectCell.run({ projectId: created.id, cellId: cell.id }, context),
    );
    expect(result.status).toBe("complete");
    expect(result.output).toMatchObject({ type: "table", rowCount: 100 });
    expect(result.output?.rows[0]?.[0]).toBe("ord_0001");
    const reloaded = await asActor(() =>
      getProjectDocument({ ownerEmail: owner, orgId }, created.id),
    );
    expect(reloaded?.cells[0]?.contents).toEqual(cell.contents);
  });

  it.each(["webmcp", "mcp", "a2a"] as const)(
    "runs a saved sample SQL cell for a %s caller that has no Analytics chat thread",
    async (caller) => {
      const toolContext = { ...context, caller };
      const created = await asActor(() =>
        createProjectAction.run(
          createProjectAction.schema.parse({
            title: `QA orders by month ${caller}`,
            sampleDataset: "orders",
          }),
          toolContext,
        ),
      );
      const project = await asActor(() =>
        getProjectDocument({ ownerEmail: owner, orgId }, created.id),
      );
      const cell = project?.cells[0];
      if (!cell) throw new Error("No sample SQL cell was persisted");
      const result = await asActor(() =>
        runProjectCell.run(
          { projectId: created.id, cellId: cell.id },
          toolContext,
        ),
      );
      expect(result.status).toBe("complete");
      expect(result.output).toMatchObject({ type: "table", rowCount: 100 });
    },
  );

  it("Steve demo: persists chartable monthly revenue from sample orders", async () => {
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      cells: [
        {
          kind: "sql",
          label: null,
          hidden: false,
          gridX: null,
          gridY: null,
          gridWidth: null,
          gridHeight: null,
          source: `select date_trunc('month', order_date) as month, sum(order_total) as revenue from "PUBLIC"."orders" group by 1 order by 1`,
          dataConnectionId: "builtin-sample-data",
          databaseSchema: null,
          resultVariable: "revenue",
          outputResult: true,
        },
      ],
    });
    const cell = project.cells[0];
    const result = await asActor(() =>
      runProjectCell.run({ projectId: project.id, cellId: cell.id }, context),
    );
    expect(result.status).toBe("complete");
    expect(result.output?.columns).toEqual([
      { name: "month", type: "datetime" },
      { name: "revenue", type: "number" },
    ]);
    expect(result.output?.rows.length).toBeGreaterThan(1);
    expect(typeof result.output?.rows[0]?.[1]).toBe("number");
    const saved = await asActor(() =>
      readCellOutput({ ownerEmail: owner, orgId }, project.id, cell.id),
    );
    expect(saved?.output).toEqual(result.output);
  });

  it("Steve demo: preserves non-finite SQL results when reading saved output", async () => {
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      cells: [
        {
          kind: "sql",
          label: null,
          hidden: false,
          gridX: null,
          gridY: null,
          gridWidth: null,
          gridHeight: null,
          source:
            "select 'Infinity'::float8 as positive, '-Infinity'::float8 as negative, 'NaN'::float8 as not_a_number from orders limit 1",
          dataConnectionId: "builtin-sample-data",
          databaseSchema: null,
          resultVariable: "values",
          outputResult: true,
        },
      ],
    });
    const cell = project.cells[0];
    const result = await asActor(() =>
      runProjectCell.run({ projectId: project.id, cellId: cell.id }, context),
    );
    expect(result.output?.rows).toEqual([["Infinity", "-Infinity", "NaN"]]);
    const saved = await asActor(() =>
      readCellOutput({ ownerEmail: owner, orgId }, project.id, cell.id),
    );
    expect(saved?.output).toEqual(result.output);
  });

  it("returns the sample rows instead of asking for a connection", async () => {
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      title: "QA sample sql project",
    });
    const added = await asActor(() =>
      addProjectCell.run({ projectId: project.id, kind: "sql" }, context),
    );
    const cell = added.project.cells.find(
      (entry: any) => entry.contents.kind === "sql",
    );
    if (!cell)
      throw new Error(
        "no sql cell: " + JSON.stringify(added.project.cells).slice(0, 400),
      );
    const { updateCell } = await import("../server/model/cells-store.js");
    await asActor(() =>
      updateCell({
        ownerEmail: owner,
        orgId,
        projectId: project.id,
        versionId: project.workingVersionId,
        cellId: cell.id,
        contents: {
          ...cell.contents,
          source:
            "select order_date, order_total, channel from orders order by order_date",
          dataConnectionId: null,
        },
      }),
    );
    const result = await asActor(() =>
      runProjectCell.run(
        { projectId: project.id, cellId: cell.id } as never,
        context as never,
      ),
    );
    expect(result.status).toBe("complete");
    expect(result.output?.type).toBe("table");
    expect(result.output?.columns.map((c: any) => c.name)).toEqual([
      "order_date",
      "order_total",
      "channel",
    ]);
    expect(result.output?.rowCount).toBeGreaterThan(0);
  });
});

it("inherits Dataframes on the next SQL cell and visualizes a result directly below its source", async () => {
  const project = await createProject({
    ownerEmail: owner,
    orgId,
    title: "Connection history",
  });
  const first = await asActor(() =>
    addProjectCell.run(
      {
        projectId: project.id,
        kind: "sql",
        table: {
          connectionId: SAMPLE_DATA_SOURCE_ID,
          tableId: "table:sample:PUBLIC:orders",
        },
      },
      context,
    ),
  );
  const origin = first.project.cells.at(0);
  if (!origin) throw Error("Missing source cell");
  expect(origin.contents).toMatchObject({
    kind: "sql",
    dataConnectionId: SAMPLE_DATA_SOURCE_ID,
    source: "select * from orders limit 100",
  });
  const run = await asActor(() =>
    runProjectCell.run({ projectId: project.id, cellId: origin.id }, context),
  );
  expect(run.output).toMatchObject({ type: "table", rowCount: 100 });
  const derived = await asActor(() =>
    addProjectCell.run(
      {
        projectId: project.id,
        kind: "sql",
        dataframe: "dataframe",
        afterCellId: origin.id,
      },
      context,
    ),
  );
  expect(derived.project.cells[1]?.contents).toMatchObject({
    connectionMode: "dataframes",
    dataConnectionId: null,
    source: 'select * from "dataframe" limit 100',
  });
  const derivedCellId = derived.createdCellId;
  if (derivedCellId === undefined) throw Error("Missing dataframe query");
  const execution = await asActor(() =>
    getExecutionSnapshot.run({ projectId: project.id }, context),
  );
  if (execution.status !== "found") throw new Error(execution.status);
  const producer = await asActor(() =>
    startNotebookRun.run(
      runRequestSchema.parse({
        requestId: randomUUID(),
        snapshot: execution.snapshot,
        mode: "cell-only",
        targetCellId: origin.id,
        cache: "bypass",
        staleValues: "reject",
      }),
      context,
    ),
  );
  if (producer.status !== "admitted") throw new Error(producer.status);
  const worker = createNotebookWorker(notebookRunStore, localDuckDb());
  expect(
    await asActor(() =>
      worker({ ownerEmail: owner, orgId, caller: "frontend" }, producer.runId),
    ),
  ).toBe(true);
  const derivedResult = await asActor(() =>
    runProjectCell.run(
      { projectId: project.id, cellId: derivedCellId },
      context,
    ),
  );
  expect(derivedResult).toMatchObject({
    status: "complete",
    output: { type: "table", rowCount: 50 },
    totalRows: "100",
  });
  if (origin.contents.kind !== "sql") throw Error("Expected SQL");
  const editedSource = {
    ...origin.contents,
    source: "select * from orders limit 2",
  };
  await asActor(() =>
    saveProjectCell.run(
      {
        projectId: project.id,
        cellId: origin.id,
        contents: editedSource,
      },
      context,
    ),
  );
  const inherited = await asActor(() =>
    addProjectCell.run({ projectId: project.id, kind: "sql" }, context),
  );
  expect(inherited.project.cells[2]?.contents).toMatchObject({
    connectionMode: "dataframes",
    dataConnectionId: null,
  });
  const chart = await asActor(() =>
    addProjectCell.run(
      {
        projectId: project.id,
        kind: "chart",
        dataframe: "dataframe",
        afterCellId: origin.id,
      },
      context,
    ),
  );
  expect(chart.project.cells[1]?.contents).toMatchObject({
    kind: "chart",
    dataframe: "dataframe",
    chartSpec: { mark: "bar", xField: null, yField: null, stacked: true },
  });
});
