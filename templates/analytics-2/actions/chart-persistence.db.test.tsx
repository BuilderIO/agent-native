import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import {
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
  type PrivateBlobProvider,
} from "@agent-native/core/private-blob";
import { runWithRequestContext } from "@agent-native/core/server";
import { act } from "react";
import type { createRoot as createRootType } from "react-dom/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { builtinEnvironments } from "vitest/runtime";

import { projectChartDataframes } from "../app/components/notebook/chart-config";
import type { NotebookCellOutputState } from "../app/components/notebook/types";
import { notebookPageOutput } from "../app/components/notebook/useNotebookResults";
import type { Cell } from "../app/lib/model/contracts.js";
import { pickSelect, selectLabels, selectTrigger } from "../app/testing/select";
import { getDb } from "../server/db/index.js";
import { createNotebookWorker } from "../server/execution/notebook-worker.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { notebookRunStore } from "../server/model/notebook-execution/service.js";
import { createProject } from "../server/model/projects-store.js";
import { runRequestSchema } from "../shared/notebook-execution.js";
import addProjectCell from "./add-project-cell.js";
import duplicateProject from "./duplicate-project.js";
import getNotebookCellExecution from "./get-notebook-cell-execution.js";
import getNotebookExecutionSnapshot from "./get-notebook-execution-snapshot.js";
import getNotebookResultPage from "./get-notebook-result-page.js";
import getNotebookTransform from "./get-notebook-transform.js";
import getProject from "./get-project.js";
import runProjectCell from "./run-project-cell.js";
import saveProjectCell from "./save-project-cell.js";
import startNotebookRun from "./start-notebook-run.js";

vi.mock("../server/execution/visualization-kernel.js", async (original) => ({
  ...(await original<
    typeof import("../server/execution/visualization-kernel.js")
  >()),
  executeVisualizationSql: (
    await import("../server/testing/visualization-sql-fixture.js")
  ).runVisualizationInPGlite,
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => {
  const { i18nMock } = await import("../app/skins/reference/testing/i18n");
  return {
    ...(await importOriginal<
      typeof import("@agent-native/core/client/i18n")
    >()),
    ...i18nMock,
    useOptionalLocale: () => null,
  };
});
let dom:
  | Awaited<ReturnType<(typeof builtinEnvironments)["happy-dom"]["setup"]>>
  | undefined;
let createRoot: typeof createRootType;
let ChartConfigBody: typeof import("../app/components/notebook/ChartConfigBody").ChartConfigBody;
let NotebookCell: typeof import("../app/components/notebook/NotebookCell").NotebookCell;
const dir = mkdtempSync(join(tmpdir(), "chart-persistence-"));
const previousDatabase = process.env.DATABASE_URL;
const orgId = `chart-test-${randomUUID()}`;
const email = "chart-owner@example.test";
const context = {
  caller: "frontend" as const,
  userEmail: email,
  orgId,
  appId: "analytics-2",
};
const actor = <T,>(fn: () => T) =>
  runWithRequestContext(
    { userEmail: email, orgId, authUserId: email, isSyntheticTraffic: true },
    fn,
  );
const blobs = new Map<string, Uint8Array>();
const storage: PrivateBlobProvider = {
  id: "chart-persistence-artifacts",
  name: "Chart persistence artifacts",
  isConfigured: () => true,
  async put({ key, data }) {
    if (!key || blobs.has(key)) throw new Error("Invalid chart artifact key");
    blobs.set(key, Uint8Array.from(data));
    return { id: key, provider: this.id, encrypted: false, opaque: true };
  },
  async read(handle) {
    const data = blobs.get(handle.id);
    if (!data) throw new Error("Chart artifact is missing");
    return { data, handle };
  },
  async delete(handle) {
    return { deleted: blobs.delete(handle.id), provider: this.id };
  },
};

beforeAll(async () => {
  dom = await builtinEnvironments["happy-dom"].setup(globalThis, {});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  ({ createRoot } = await import("react-dom/client"));
  ({ ChartConfigBody } =
    await import("../app/components/notebook/ChartConfigBody"));
  ({ NotebookCell } = await import("../app/components/notebook/NotebookCell"));
  process.env.DATABASE_URL = `pglite:${join(dir, "db")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "chart_test_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "Chart test",
    createdBy: email,
    createdAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId,
    email,
    role: "owner",
    joinedAt: Date.now(),
  });
  registerPrivateBlobProvider(storage);
});
afterAll(async () => {
  await closeDbExec();
  await dom?.teardown(globalThis);
  unregisterPrivateBlobProvider(storage.id);
  vi.unstubAllGlobals();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  rmSync(dir, { recursive: true, force: true });
});

function chartProject(title: string) {
  return createProject({
    ownerEmail: email,
    orgId,
    title,
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
          "select order_date, order_total, channel from orders order by order_date limit 3",
        dataConnectionId: "builtin-sample-data",
        databaseSchema: null,
        resultVariable: "orders",
        outputResult: true,
      },
    ],
  });
}

function runSource(projectId: string, cellId: string) {
  return actor(async () => {
    const execution = await getNotebookExecutionSnapshot.run(
      { projectId },
      context,
    );
    assert(execution.status === "found");
    const receipt = await startNotebookRun.run(
      runRequestSchema.parse({
        requestId: randomUUID(),
        snapshot: execution.snapshot,
        targetCellId: cellId,
        mode: "cell-only",
        staleValues: "reject",
        cache: "bypass",
      }),
      context,
    );
    assert(receipt.status === "admitted");
    const worker = createNotebookWorker(notebookRunStore);
    expect(
      await worker(
        { ownerEmail: email, orgId, caller: context.caller },
        receipt.runId,
      ),
    ).toBe(true);
  });
}

async function insertChartFromPill(
  projectId: string,
  sql: Cell,
  outputState: NotebookCellOutputState | undefined,
) {
  assert(sql.contents.kind === "sql");
  const source = sql.contents;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let addedFromPill:
    | Promise<Awaited<ReturnType<typeof addProjectCell.run>>>
    | undefined;
  try {
    const noop = () => {};
    act(() =>
      root.render(
        <NotebookCell
          cell={sql}
          title="SQL 1"
          connections={[]}
          canEdit
          busy={false}
          running={false}
          saving={false}
          deleting={false}
          connectionPending={false}
          connectionId={source.dataConnectionId}
          draftText={source.source}
          dirty={false}
          stale={false}
          outputState={outputState}
          error={null}
          onTextChange={noop}
          onSaveDraft={noop}
          onAddResultCell={(kind, dataframe) => {
            addedFromPill = actor(() =>
              addProjectCell.run(
                { projectId, kind, dataframe, afterCellId: sql.id },
                context,
              ),
            );
          }}
          onRun={noop}
          onDiscard={noop}
          onOverwrite={noop}
          onDelete={noop}
          onSelectConnection={noop}
          onDismissError={noop}
          onRetryError={noop}
        />,
      ),
    );
    const pill = [...host.querySelectorAll(".nb-result-variable button")].find(
      (button) => button.textContent === source.resultVariable,
    );
    assert(pill);
    await act(async () =>
      pill.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          cancelable: true,
        }),
      ),
    );
    const visualize = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === "Visualize in chart");
    assert(visualize);
    act(() => visualize.click());
    assert(addedFromPill);
    return addedFromPill;
  } finally {
    act(() => root.unmount());
    host.remove();
  }
}

it("keeps the dataframe bound and both axes empty when visualizing a completed query from its pill", async () => {
  const project = await chartProject("Visualize a completed query");
  const sql = project.cells[0];
  await runSource(project.id, sql.id);
  const execution = await actor(() =>
    getNotebookCellExecution.run(
      { projectId: project.id, cellId: sql.id },
      context,
    ),
  );
  assert(execution.status === "found" && execution.resultId);
  const { resultId } = execution;
  const page = await actor(() =>
    getNotebookResultPage.run({ resultId }, context),
  );
  assert(page.status === "ready");
  const { createdCellId } = await insertChartFromPill(project.id, sql, {
    output: notebookPageOutput(page),
    artifactPage: page.page,
    pageRequestId: resultId,
    resultFields: page.manifest.fields,
  });
  const projectRead = await actor(() =>
    getProject.run({ projectId: project.id }, context),
  );
  const saved = projectRead.project.cells.find(
    ({ id }) => id === createdCellId,
  );
  expect(saved?.contents).toMatchObject({
    kind: "chart",
    dataframe: "orders",
    chartSpec: {
      sourceCellId: sql.id,
      sourceExportId: "result",
      mark: "bar",
      stacked: true,
      xField: null,
      yField: null,
    },
  });
  const projection = await actor(() =>
    getNotebookTransform.run(
      { projectId: project.id, cellId: createdCellId, mode: "chart" },
      context,
    ),
  );
  expect(projection.sources).toMatchObject([
    { binding: { cellId: sql.id, exportId: "result" }, name: "orders" },
  ]);
  expect(projection.result).toEqual({ status: "unconfigured" });
});

it("adds a bound Stacked column from the dataframe pill and reopens saved legacy chart settings", async () => {
  const project = await chartProject("Chart persistence");
  const sql = project.cells[0];
  assert(sql.contents.kind === "sql");
  const run = await actor(() =>
    runProjectCell.run({ projectId: project.id, cellId: sql.id }, context),
  );
  expect(run.status).toBe("complete");
  const existing = await actor(() =>
    addProjectCell.run({ projectId: project.id, kind: "markdown" }, context),
  );
  const notebook = await actor(() =>
    getProject.run({ projectId: project.id }, context),
  );
  const added = await insertChartFromPill(
    project.id,
    sql,
    notebook.outputs[sql.id],
  );
  expect(added.project.cells.map(({ id }) => id)).toEqual([
    sql.id,
    added.createdCellId,
    existing.createdCellId,
  ]);
  const cell = added.project.cells.find(
    (item) => item.id === added.createdCellId,
  );
  assert(cell && cell.contents.kind === "chart");
  let contents = cell.contents;
  let loaded = await actor(() =>
    getProject.run({ projectId: project.id }, context),
  );
  let saved = loaded.project.cells.find((item) => item.id === cell.id);
  assert(saved && saved.contents.kind === "chart");
  contents = saved.contents;
  expect(contents.dataframe).toBe("orders");
  expect(contents.chartSpec).toMatchObject({
    version: 3,
    sourceCellId: sql.id,
    sourceExportId: "result",
    mark: "bar",
    stacked: true,
    xField: null,
    yField: null,
  });
  const {
    revision: _revision,
    sourceExportId: _export,
    ...legacy
  } = contents.chartSpec;
  const { autoBind: _autoBind, ...legacySpec } = legacy;
  contents = { ...contents, chartSpec: { ...legacySpec, version: 2 } };
  await actor(() =>
    saveProjectCell.run(
      { projectId: project.id, cellId: cell.id, contents },
      context,
    ),
  );
  function mountChart() {
    const host = document.createElement("div");
    document.body.append(host);
    return { host, root: createRoot(host) };
  }
  let chart = mountChart();
  const unmountChart = () => {
    act(() => chart.root.unmount());
    chart.host.remove();
  };
  function render() {
    const dataframes = projectChartDataframes(
      loaded.project.cells,
      loaded.outputs,
    );
    act(() =>
      chart.root.render(
        <ChartConfigBody
          dataframe={contents.dataframe}
          spec={contents.chartSpec}
          dataframes={dataframes}
          onChange={(next) => {
            contents = {
              ...contents,
              ...next,
              chartSpec: { ...contents.chartSpec, ...next.chartSpec },
            };
          }}
        />,
      ),
    );
  }
  try {
    render();
    const { host } = chart;
    const pick = (label: string, choice: string) => {
      pickSelect(host, label, choice);
      render();
    };
    expect(
      [...host.querySelectorAll(".nb-chart-type[aria-pressed=true]")].map(
        (button) => button.textContent,
      ),
    ).toEqual(["Stacked column", "Chart"]);
    expect(selectTrigger(host, "DataFrame").textContent).toBe("orders");
    expect(selectTrigger(host, "X-axis").textContent).toBe("No X-axis");
    expect(selectTrigger(host, "Y-axis").textContent).toBe("No Y-axis");
    expect(selectLabels(host, "Y-axis")).toContain("Count of Records");
    expect(
      host
        .querySelector('input[aria-label="Chart title"]')
        ?.getAttribute("placeholder"),
    ).toBe("Add title…");
    const tooltip = [...host.querySelectorAll("label")].find(
      (label) => label.textContent.trim() === "Include X, Y, Color & Facet",
    );
    expect(tooltip?.querySelector("input")?.checked).toBe(true);
    expect(host.querySelectorAll(".nb-chart-bar")).toHaveLength(0);
    pick("X-axis", "order_date");
    expect(selectTrigger(host, "Time unit").textContent).toBe("Month");
    pick("Y-axis", "Count of Records");
    expect(host.querySelector(".nb-chart-bar title")?.textContent).toBe(
      "Month of order_date: Oct 2025\nCount of Records: 3",
    );
    pick("Y-axis", "order_total");
    expect(selectTrigger(host, "Aggregation").textContent).toBe("Sum");
    const table = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Table",
    );
    assert(table);
    act(() => table.click());
    expect(
      host.querySelector(".nb-table tbody td:nth-of-type(2)")?.textContent,
    ).toBe("12,960");
    const chartButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Chart",
    );
    assert(chartButton);
    act(() => chartButton.click());
    expect(host.querySelectorAll(".nb-chart-bar")).toHaveLength(1);
    const line = [...host.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Line",
    );
    assert(line);
    act(() => line.click());
    render();
    pick("X-axis", "channel");
    await actor(() =>
      saveProjectCell.run(
        { projectId: project.id, cellId: cell.id, contents },
        context,
      ),
    );
    const renamedSql = { ...sql.contents, resultVariable: "renamed_orders" };
    await actor(() =>
      saveProjectCell.run(
        { projectId: project.id, cellId: sql.id, contents: renamedSql },
        context,
      ),
    );
    loaded = await actor(() =>
      getProject.run({ projectId: project.id }, context),
    );
    saved = loaded.project.cells.find((item) => item.id === cell.id);
    assert(saved && saved.contents.kind === "chart");
    contents = saved.contents;
    expect(contents.chartSpec).toMatchObject({
      mark: "line",
      xField: "channel",
      yField: "order_total",
    });
    unmountChart();
    chart = mountChart();
    render();
    const reloadedHost = chart.host;
    expect(reloadedHost.querySelector(".nb-chart-line")).not.toBeNull();
    const dataframe = projectChartDataframes(
      loaded.project.cells,
      loaded.outputs,
    )[0];
    assert(dataframe);
    expect(dataframe.name).toBe("renamed_orders");
    const channel = dataframe.columns.findIndex(
      (column) => column.name === "channel",
    );
    const total = dataframe.columns.findIndex(
      (column) => column.name === "order_total",
    );
    expect(channel).toBeGreaterThanOrEqual(0);
    expect(total).toBeGreaterThanOrEqual(0);
    expect(dataframe.rows.map((row) => [row[channel], row[total]])).toEqual([
      ["marketplace", 4530],
      ["marketplace", 1864],
      ["marketplace", 6566],
    ]);
    const lineDrawing = reloadedHost.querySelector(".nb-chart-line");
    assert(lineDrawing);
    expect(lineDrawing.getAttribute("points")?.split(" ")).toHaveLength(1);
    expect(reloadedHost.querySelectorAll(".nb-chart-point title")).toHaveLength(
      1,
    );
    expect(
      reloadedHost.querySelector(".nb-chart-point title")?.textContent,
    ).toBe("channel: marketplace\nSum of order_total: 12,960");
    expect(selectTrigger(reloadedHost, "X-axis").textContent).toBe("channel");
    expect(selectTrigger(reloadedHost, "Y-axis").textContent).toBe(
      "order_total",
    );
    const { project: copy } = await actor(() =>
      duplicateProject.run({ projectId: project.id }, context),
    );
    const copiedSql = copy.cells.find((cell) => cell.contents.kind === "sql");
    const copiedChart = copy.cells.find(
      (cell) => cell.contents.kind === "chart",
    );
    assert(copiedSql && copiedChart?.contents.kind === "chart");
    expect(copiedSql.id).not.toBe(sql.id);
    expect(copiedChart.contents.chartSpec.sourceCellId).toBe(copiedSql.id);
  } finally {
    unmountChart();
  }
});

it("reopens and copies configured full-result chart fields after its producer is renamed", async () => {
  const project = await chartProject("Full-result chart persistence");
  const sql = project.cells[0];
  assert(sql.contents.kind === "sql");
  const source = sql.contents;
  const added = await actor(() =>
    addProjectCell.run(
      { projectId: project.id, kind: "chart", afterCellId: sql.id },
      context,
    ),
  );
  const chart = added.project.cells.find(
    ({ id }) => id === added.createdCellId,
  );
  assert(chart?.contents.kind === "chart");
  const contents = chart.contents;

  const transform = (projectId: string, cellId: string) =>
    actor(() =>
      getNotebookTransform.run({ projectId, cellId, mode: "chart" }, context),
    );

  await runSource(project.id, sql.id);
  const initial = await transform(project.id, chart.id);
  expect(initial.result).toEqual({ status: "unconfigured" });
  const binding = initial.sources.find(
    ({ binding }) => binding.cellId === sql.id,
  );
  assert(binding);
  const channel = binding.fields.find(({ name }) => name === "channel");
  const total = binding.fields.find(({ name }) => name === "order_total");
  assert(channel && total);
  const chartSpec = {
    ...contents.chartSpec,
    mark: "line" as const,
    xField: channel.fieldId,
    yField: total.fieldId,
    yAggregation: "sum" as const,
    filters: [
      { fieldId: channel.fieldId, op: "eq" as const, value: "marketplace" },
    ],
  };
  await actor(() =>
    saveProjectCell.run(
      {
        projectId: project.id,
        cellId: chart.id,
        contents: { ...contents, chartSpec },
      },
      context,
    ),
  );
  await actor(() =>
    saveProjectCell.run(
      {
        projectId: project.id,
        cellId: sql.id,
        contents: { ...source, resultVariable: "renamed_orders" },
      },
      context,
    ),
  );
  await runSource(project.id, sql.id);

  const readback = await actor(() =>
    getProject.run({ projectId: project.id }, context),
  );
  const saved = readback.project.cells.find(({ id }) => id === chart.id);
  expect(saved?.contents).toMatchObject({ chartSpec });
  const renamed = await transform(project.id, chart.id);
  expect(renamed.sources[0]?.name).toBe("renamed_orders");
  expect(renamed.result).toMatchObject({
    status: "ready",
    rows: [{ x: "marketplace", value: 12960 }],
  });

  const { project: copy } = await actor(() =>
    duplicateProject.run({ projectId: project.id }, context),
  );
  const copiedSql = copy.cells.find(({ contents }) => contents.kind === "sql");
  const copiedChart = copy.cells.find(
    ({ contents }) => contents.kind === "chart",
  );
  assert(copiedSql && copiedChart?.contents.kind === "chart");
  expect(copiedSql.id).not.toBe(sql.id);
  expect(copiedChart.contents.chartSpec).toEqual({
    ...chartSpec,
    sourceCellId: copiedSql.id,
  });
  await runSource(copy.id, copiedSql.id);
  const copied = await transform(copy.id, copiedChart.id);
  expect(copied.sources[0]?.binding.cellId).toBe(copiedSql.id);
  expect(copied.result).toMatchObject({
    status: "ready",
    rows: [{ x: "marketplace", value: 12960 }],
  });
});
