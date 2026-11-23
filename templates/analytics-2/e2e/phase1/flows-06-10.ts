import { randomUUID } from "node:crypto";

import {
  expect,
  type Locator,
  type Page,
  type Request,
  type Response,
} from "@playwright/test";
import { z } from "zod";

import type { AppSessionProjection } from "../../shared/app-session-operations.js";
import type {
  CellRunReceipt,
  RunReceipt as NotebookRunReceipt,
} from "../../shared/notebook-execution.js";
import type {
  NotebookEvent,
  NotebookSnapshot,
} from "../../shared/notebook-operations.js";
import type { PublishPreviewDetail } from "../../shared/project-publish.js";
import {
  visualizationDrillInputSchema,
  visualizationDrillOutputSchema,
  type ChartTransformResult,
  type PivotTransformResult,
} from "../../shared/visualization-contracts.js";
import { editorOf, SAMPLE_CONNECTION } from "../daily/notebook.helpers.js";
import { waitForReadyPublishPreview } from "../publish-fixture.js";
import { writeSqlEditor } from "../sql-editor.js";
import { readCellExecution, readCompleteCellRows } from "./cell-execution.js";
import { readAttempt } from "./execution-readback.js";
import {
  CHART_CAP_SQL,
  CHART_REPLACEMENT_SQL,
} from "./fixtures/chart-sources.js";
import { inputSave } from "./input-save.js";
import { attestKernel } from "./kernel-attestation.js";
import { fillAppLayoutGap, pressSqlRun } from "./mounted-gestures.js";
import type { FlowContext, FlowDefinition } from "./runtime.js";
import {
  pivotMatrixRows,
  readVisualizationTransform,
} from "./visualization-readback.js";

const LOAD = { timeout: 30_000 };
const HEALTHY = { timeout: 120_000 };
export const PYTHON_SOURCE_SQL =
  "select n from (values (42), (84)) as fixture(n) order by n";
const PYTHON_PRODUCER = [
  "import pandas as pd",
  'total = int(dataframe["n"].sum())',
  'display(pd.DataFrame({"n": [total]}))',
].join("\n");
const PYTHON_FAILURE = 'print("before missing producer")\ntotal + 1';

export const CHART_SOURCE = `select date '2026-01-01' as day, 42 as amount, 'marketplace' as channel
union all select date '2025-11-01', 84, 'partner'
union all select date '2025-10-02', 1, 'direct' from generate_series(1,50)
union all select date '2025-10-30', 2, 'direct' from generate_series(1,10)`;
export const PIVOT_SOURCE = `select * from (values
  ('North','web','A',42), ('North','web','B',8),
  ('North','store','A',12), ('South','web','B',84)
) as regional("Region","Channel","Product","Amount")`;
const REGION_OPTIONS = ["North", "South"] as const;
export const REGION_SQL = (factor = 1) => `select sum(amount)::integer as total
from (values ('North',${42 * factor}), ('North',${8 * factor}),
  ('North',${12 * factor}), ('South',84)) as sales(region,amount)
where region = {{ region }}`;
const CHART_TITLE = "Revenue by month";

type Project = {
  id: string;
  cells: { id: string; contents: Record<string, unknown> }[];
  publishedVersionId: string | null;
};

type ProjectRead = {
  project: Project;
  outputs: Record<string, { runId: string }>;
  queryStates: Record<string, { requestId: string }>;
};

type Kernel = {
  generation: string;
  status: "found";
  variables: { name: string; kind: string; producerCellId: string }[];
};

const draft = (projectId: string) => ({ kind: "draft", projectId });
const notebook = (projectId: string) => `/project/${projectId}/latest`;
const cell = (page: Page, id: string) =>
  page.locator(`[data-notebook-cell="${id}"]`);

const cells = (page: Page) => page.locator("[data-notebook-cell]");
const readProject = (flow: FlowContext, projectId: string) =>
  flow.action<ProjectRead>("get-project", { projectId });

async function seedNotebook(flow: FlowContext, title: string) {
  const created = await flow.action<{ id: string }>("create-project", {
    title: flow.name(title),
  });
  expect(created.id).toBeTruthy();
  flow.id("projectId", created.id);
  return created.id;
}

async function seedSql(
  flow: FlowContext,
  projectId: string,
  source: string,
  key = "sourceCellId",
  beforeCellId?: string,
) {
  const added = await flow.action<{ project: Project; createdCellId: string }>(
    "add-project-cell",
    { projectId, kind: "sql", ...(beforeCellId && { beforeCellId }) },
  );
  const id = added.createdCellId;
  const stored = added.project.cells.find((item) => item.id === id);
  if (!stored)
    throw new Error("SQL fixture cell was absent from the action response");
  await flow.action("save-project-cell", {
    projectId,
    cellId: id,
    contents: {
      ...stored.contents,
      source,
      dataConnectionId: SAMPLE_CONNECTION,
    },
  });
  flow.id(key, id);
  return id;
}

async function checkTable(page: Page, id: string, values: string[]) {
  const result = cell(page, id).locator(".nb-output-section");
  await expect(result).toBeVisible(HEALTHY);
  for (const value of values) {
    await expect(
      result.getByRole("cell", { name: value, exact: true }).first(),
    ).toBeVisible(LOAD);
  }
}

async function runSql(page: Page, id: string, values: string[]) {
  const response = await pressSqlRun(cell(page, id), () =>
    waitForAction(page, "start-notebook-run", "POST", LOAD),
  );
  const receipt = await responseBody<NotebookRunReceipt>(response);
  expect(receipt.status).toBe("admitted");
  expect(receipt.plan.admittedCellIds).toContain(id);
  await checkTable(page, id, values);
}

function waitForAction(
  page: Page,
  action: string,
  method = "POST",
  timeout = HEALTHY,
) {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith(
        `/_agent-native/actions/${action}`,
      ) && response.request().method() === method,
    timeout,
  );
}

async function responseBody<T>(response: Response): Promise<T> {
  expect(
    response.ok(),
    `mounted action returned HTTP ${response.status()}`,
  ).toBe(true);
  return (await response.json()) as T;
}

async function addFromBar(flow: FlowContext, name: string) {
  const before = await cells(flow.page).count();
  const bar = flow.page.getByRole("group", { name: "Add code cell" }).last();
  await flow.require(bar, "Notebook add-cell bar");
  const direct = bar.getByRole("button", { name, exact: true });
  if (await direct.isVisible()) {
    await direct.click();
  } else {
    await bar
      .getByRole("button", {
        name: /^(Dropdown|Multiselect|Slider|Number input|Text input)$/.test(
          name,
        )
          ? "Inputs"
          : "More",
        exact: true,
      })
      .click();
    const item = flow.page.getByRole("menuitem", { name, exact: true });
    await flow.require(item, `Add cell → ${name}`);
    await item.click();
  }
  await expect(cells(flow.page)).toHaveCount(before + 1, LOAD);
  const id = await cells(flow.page).last().getAttribute("data-notebook-cell");
  if (!id) throw new Error(`${name} cell has no identity`);
  return id;
}

async function insertFromPill(
  flow: FlowContext,
  sourceId: string,
  menuLabel: "Visualize in chart" | "Pivot dataframe",
) {
  const before = await cells(flow.page).count();
  const pill = cell(flow.page, sourceId).getByRole("button", {
    name: "Actions for dataframe",
  });
  await flow.require(pill, "Dataframe pill actions");
  await pill.click();
  const entry = flow.page.getByRole("menuitem", {
    name: menuLabel,
    exact: true,
  });
  await flow.require(entry, menuLabel);
  await entry.click();
  await expect(cells(flow.page)).toHaveCount(before + 1, LOAD);
  const ids = await cells(flow.page).evaluateAll((elements) =>
    elements.map((node) => node.getAttribute("data-notebook-cell")),
  );
  const id = ids[ids.indexOf(sourceId) + 1];
  if (!id || ids.indexOf(sourceId) === -1) {
    throw new Error(`${menuLabel} did not insert below its producer`);
  }
  return id;
}

async function chooseField(root: Locator, axis: string, label: string) {
  const select = root.getByRole("combobox", { name: axis, exact: true });
  await expect(select).toBeEnabled(LOAD);
  await select.click();
  await root
    .page()
    .getByRole("listbox")
    .getByRole("option", { name: label, exact: true })
    .click();
}

function chartMode(root: Locator, name: "Chart" | "Table" | "Pivot") {
  return root
    .getByRole("tab", { name, exact: true })
    .or(root.getByRole("button", { name, exact: true }));
}

function scalar(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("value" in value))
    return value;
  if (
    "type" in value &&
    (value.type === "int64" || value.type === "integer") &&
    typeof value.value === "string" &&
    /^-?\d+$/.test(value.value) &&
    Number.isSafeInteger(Number(value.value))
  )
    return Number(value.value);
  return value.value;
}

function readyTransform(
  flow: FlowContext,
  projectId: string,
  cellId: string,
  mode: "chart",
): Promise<ChartTransformResult>;
function readyTransform(
  flow: FlowContext,
  projectId: string,
  cellId: string,
  mode: "pivot",
): Promise<PivotTransformResult>;
async function readyTransform(
  flow: FlowContext,
  projectId: string,
  cellId: string,
  mode: "chart" | "pivot",
) {
  const read = () => readVisualizationTransform(flow, projectId, cellId, mode);
  let current = await read();
  await expect
    .poll(async () => {
      if (current.status !== "ready") current = await read();
      return current.status;
    }, HEALTHY)
    .toBe("ready");
  if (
    current.status !== "ready" ||
    ("kind" in current ? current.kind : "pivot") !== mode
  )
    throw new Error(`Expected a ready ${mode} transform`);
  expect(current.source.result.resultId).toBeTruthy();
  expect(current.source.completeness).toBe("complete");
  expect(current.source.result.snapshot.projectId).toBe(projectId);
  expect(current.visualizationResultId).toBeTruthy();
  flow.id("sourceResultId", current.source.result.resultId);
  flow.id(
    "visualizationResultId",
    z.string().min(1).parse(current.visualizationResultId),
  );
  return current;
}

function pivotValue(root: Locator, value: string) {
  return root
    .getByRole("cell")
    .filter({ hasText: new RegExp(`^${value.replaceAll(".", "\\.")}$`) });
}

async function choosePivotOption(
  page: Page,
  root: Locator,
  name: string,
  option: string,
  index = 0,
) {
  await root.getByRole("combobox", { name, exact: true }).nth(index).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function runPython(
  flow: FlowContext,
  page: Page,
  projectId: string,
  id: string,
  mode: "auto" | "cell-only",
  terminal: "complete" | "failed",
) {
  const root = cell(page, id);
  const run = root.getByRole("button", {
    name: /^Run Code \d+\b/,
  });
  await flow.require(run, "Python execution");
  let command = run;
  if (mode === "cell-only") {
    const modes = root.getByRole("button", { name: "Run mode", exact: true });
    await flow.require(modes, "Python run mode selector");
    await modes.click();
    command = page.getByRole("menuitem", { name: /^Cell only\b/ });
    await flow.require(command, "Python Cell only run mode");
  }
  const [response] = await Promise.all([
    waitForAction(page, "start-notebook-run"),
    command.click(),
  ]);
  const { runId } = await responseBody<NotebookRunReceipt>(response);
  const read = async () =>
    readAttempt(await flow.action("get-notebook-run", { runId }), runId, id);
  let stored = await read();
  expect(stored.run.request.mode).toBe(mode);
  await expect
    .poll(async () => {
      if (stored.state.status !== terminal) stored = await read();
      return stored.state.status;
    }, HEALTHY)
    .toBe(terminal);
  const attempt = await readCellExecution(flow, projectId, id);
  expect(attempt).toMatchObject({
    runId,
    attemptId: stored.attempt.attemptId,
    state: stored.state,
  });
  await attestKernel(flow);
  const kernel = await flow.action<Kernel>("get-notebook-kernel-session", {
    scope: draft(projectId),
  });
  expect(kernel.status).toBe("found");
  expect(attempt.kernelGeneration).toBe(kernel.generation);
  return { runId, attempt };
}

const python: FlowDefinition = {
  id: "06-python-after-sql",
  async run(flow) {
    const { page } = flow;
    const projectId = await flow.step(
      "Seed the SQL export with 42 and 84",
      () => flow.createNotebookWithKernelCleanup("Python after SQL"),
    );
    const sqlId = await seedSql(flow, projectId, PYTHON_SOURCE_SQL);
    await flow.open(notebook(projectId));
    await flow.transition("Run the SQL producer from the notebook", () =>
      runSql(page, sqlId, ["42", "84"]),
    );
    await flow.readback("Read the SQL producer bytes", async () => {
      expect(await readCompleteCellRows(flow, projectId, sqlId, "2")).toEqual([
        [42],
        [84],
      ]);
    });
    await flow.screenshot("sql-producer");

    const producerId = await flow.step("Add Python from the cell bar", () =>
      addFromBar(flow, "Python"),
    );
    flow.id("pythonProducerCellId", producerId);
    const source = editorOf(cell(page, producerId));
    await source.fill(PYTHON_PRODUCER);
    const produced = await flow.transition(
      "Run Python against the SQL export and display 126",
      async () => {
        const run = await runPython(
          flow,
          page,
          projectId,
          producerId,
          "auto",
          "complete",
        );
        await checkTable(page, producerId, ["126"]);
        return run;
      },
    );
    flow.id("producerRunId", produced.runId);
    await flow.oracle(
      "Check the Python editor and output conventions",
      async () => {
        await expect(
          cell(page, producerId).locator(".nb-cell-title"),
        ).toHaveText(/^Code \d+$/);
        await expect(source).toHaveAttribute(
          "placeholder",
          "Type Python or use AI...",
        );
        await expect(
          cell(page, producerId)
            .getByText(/^1 row(s)?\b/)
            .first(),
        ).toBeVisible();
        const modes = cell(page, producerId).getByRole("button", {
          name: "Run mode",
          exact: true,
        });
        await modes.click();
        await expect(
          page.getByRole("menuitem", { name: /^Auto\b/ }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
      },
    );
    const consumerId = await addFromBar(flow, "Python");
    flow.id("pythonConsumerCellId", consumerId);
    await editorOf(cell(page, consumerId)).fill("total + 1");
    const consumed = await flow.transition(
      "Run the consumer in the same kernel",
      async () => {
        const run = await runPython(
          flow,
          page,
          projectId,
          consumerId,
          "cell-only",
          "complete",
        );
        await expect(
          cell(page, consumerId).getByText("127", { exact: true }),
        ).toBeVisible(LOAD);
        return run;
      },
    );
    flow.id("consumerRunId", consumed.runId);
    const scope = draft(projectId);
    const kernel = await flow.readback(
      "Read source, typed outputs and live generation independently",
      async () => {
        const { project } = await readProject(flow, projectId);
        expect(
          project.cells.find((entry) => entry.id === producerId)?.contents
            .source,
        ).toBe(PYTHON_PRODUCER);
        expect(
          project.cells.find((entry) => entry.id === consumerId)?.contents
            .source,
        ).toBe("total + 1");
        const displays = produced.attempt.outputs.filter(
          ({ kind }) => kind === "table",
        );
        expect(displays).toHaveLength(1);
        const display = displays[0];
        if (display?.kind !== "table")
          throw new Error("Python did not emit a dataframe");
        const displayed = await readCompleteCellRows(
          flow,
          projectId,
          producerId,
          "1",
          produced.runId,
          display.resultId,
        );
        expect(displayed.map((row) => row.map(scalar))).toEqual([[126]]);
        const expression = await readCellExecution(flow, projectId, consumerId);
        expect(expression).toMatchObject({
          runId: consumed.runId,
          attemptId: consumed.attempt.attemptId,
          state: consumed.attempt.state,
        });
        expect(expression.outputs).toContainEqual({
          kind: "text",
          data: "127",
          value: 127,
        });
        const session = await flow.action<Kernel>(
          "get-notebook-kernel-session",
          { scope },
        );
        expect(session.variables).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: "total",
              kind: "scalar",
              producerCellId: producerId,
            }),
          ]),
        );
        expect(consumed.attempt.kernelGeneration).toBe(session.generation);
        expect(produced.attempt.kernelGeneration).toBe(session.generation);
        return session;
      },
    );
    flow.id("kernelGeneration", kernel.generation);
    await flow.cold(
      "Reopen and run only the consumer without restarting",
      async (coldPage) => {
        await coldPage.goto(flow.url(notebook(projectId)));
        await checkTable(coldPage, producerId, ["126"]);
        const replay = await runPython(
          flow,
          coldPage,
          projectId,
          consumerId,
          "cell-only",
          "complete",
        );
        expect(replay.attempt.kernelGeneration).toBe(kernel.generation);
        expect(replay.attempt.attemptId).not.toBe(consumed.attempt.attemptId);
        await expect(
          cell(coldPage, consumerId).getByText("127", { exact: true }),
        ).toBeVisible();
      },
    );
    await flow.rejecting(
      "Restart and prove the lost name fails with preceding stdout",
      async () => {
        await page
          .getByRole("button", { name: "Run all options", exact: true })
          .click();
        const restart = page.getByRole("menuitem", {
          name: "Restart",
          exact: true,
        });
        await flow.require(restart, "Restart kernel");
        await restart.click();
        const next = () =>
          flow.action<Kernel>("get-notebook-kernel-session", { scope });
        await expect
          .poll(
            async () =>
              BigInt((await next()).generation) > BigInt(kernel.generation),
          )
          .toBe(true);
        await flow.rejectAction(
          "control-notebook-kernel",
          {
            scope,
            requestId: randomUUID(),
            expectedGeneration: kernel.generation,
            operation: "restart",
          },
          /kernel_generation_conflict/,
        );
        expect((await next()).variables).toEqual([]);
        await cell(page, producerId).focus();
        await page.keyboard.press("d");
        await page.keyboard.press("d");
        await expect(cell(page, producerId)).toHaveCount(0);
        await editorOf(cell(page, consumerId)).fill(PYTHON_FAILURE);
        const failed = await runPython(
          flow,
          page,
          projectId,
          consumerId,
          "cell-only",
          "failed",
        );
        expect(failed.attempt.outputs).toEqual([
          {
            kind: "stream",
            channel: "stdout",
            text: "before missing producer\n",
          },
          {
            kind: "error",
            line: 2,
            trace: expect.stringContaining("NameError"),
          },
        ]);
        expect(failed.attempt.resultId).toBeNull();
        const output = cell(page, consumerId).locator(".nb-output-section");
        await expect(
          output.getByText("before missing producer", { exact: true }),
        ).toBeVisible();
        await expect(output.getByText(/NameError/).first()).toBeVisible();
        await expect(
          output.getByRole("button", { name: "Fix with agent", exact: true }),
        ).toBeVisible();
        await expect(output.getByText("127", { exact: true })).toHaveCount(0);
      },
    );
    await flow.screenshot("python-traceback");
  },
};

const chart: FlowDefinition = {
  id: "07-chart-query-result",
  async run(flow) {
    const { page } = flow;
    const projectId = await seedNotebook(flow, "Chart query result");
    const sqlId = await seedSql(flow, projectId, CHART_SOURCE);
    await flow.open(notebook(projectId));
    await flow.step("Run the deliberately unsorted 62-row producer", () =>
      runSql(page, sqlId, ["42", "84"]),
    );
    const chartId = await flow.transition(
      "Visualize in chart from its dataframe pill",
      () => insertFromPill(flow, sqlId, "Visualize in chart"),
    );
    flow.id("chartCellId", chartId);
    const root = cell(page, chartId);
    await flow.screenshot("chart-inserted");
    await flow.oracle(
      "Check initial binding, mark, channels and tooltip",
      async () => {
        expect(
          (await readProject(flow, projectId)).project.cells.find(
            ({ id }) => id === chartId,
          )?.contents.chartSpec,
        ).toMatchObject({ sourceCellId: sqlId, xField: null, yField: null });
        await expect(
          root.getByRole("combobox", { name: "DataFrame", exact: true }),
        ).toHaveText("dataframe");
        const stacked = root.getByRole("button", {
          name: "Stacked column",
          exact: true,
        });
        await flow.require(stacked, "Stacked column chart type");
        await expect(stacked).toHaveAttribute("aria-pressed", "true");
        await expect(
          root.getByRole("combobox", { name: "X-axis", exact: true }),
        ).toHaveText("No X-axis");
        const yAxis = root.getByRole("combobox", {
          name: "Y-axis",
          exact: true,
        });
        await expect(yAxis).toHaveText("No Y-axis");
        await yAxis.click();
        await expect(
          page
            .getByRole("listbox")
            .getByRole("option", { name: "Count of Records", exact: true }),
        ).toBeEnabled();
        await page.keyboard.press("Escape");
        const appearance = root.getByText("Appearance", { exact: true });
        await appearance.click();
        await expect(
          root.getByRole("checkbox", {
            name: "Include X, Y, Color & Facet",
            exact: true,
          }),
        ).toBeChecked();
        await appearance.click();
      },
    );
    await flow.transition(
      "Bind day, amount and channel then toggle Chart/Table",
      async () => {
        await chooseField(root, "X-axis", "day");
        await expect(
          root.getByRole("combobox", { name: "Time unit" }),
        ).toHaveText("Month");
        await chooseField(root, "Y-axis", "amount");
        await expect(
          root.getByRole("combobox", { name: "Aggregation" }),
        ).toHaveText("Sum");
        await chooseField(root, "Color by", "channel");
        await root
          .getByRole("textbox", { name: "Chart title" })
          .fill(CHART_TITLE);
        const table = await chartMode(root, "Table");
        await flow.require(table, "Chart/Table toggle");
        await table.click();
        await expect(
          root.getByRole("cell", { name: "70", exact: true }),
        ).toBeVisible();
        await expect(
          root.getByRole("cell", { name: "84", exact: true }),
        ).toBeVisible();
        await expect(
          root.getByRole("cell", { name: "42", exact: true }),
        ).toBeVisible();
        await (await chartMode(root, "Chart")).click();
      },
    );
    const transform = await flow.readback(
      "Read complete monthly aggregate and stable palette",
      async () => {
        const result = await readyTransform(flow, projectId, chartId, "chart");
        const source = await readCellExecution(flow, projectId, sqlId);
        expect(result.source.result.resultId).toBe(source.resultId);
        expect(result.source.rowCount).toBe(62);
        expect(result.capped).toBe(false);
        expect(
          result.rows.map(({ x, series, value }) => [x, series, value]),
        ).toEqual([
          ["2025-10-01", "direct", 70],
          ["2025-11-01", "partner", 84],
          ["2026-01-01", "marketplace", 42],
        ]);
        expect(result.categories).toEqual(["direct", "marketplace", "partner"]);
        const legend = root.getByRole("list", { name: "channel", exact: true });
        await expect(legend.getByRole("listitem")).toHaveText([
          "marketplace",
          "direct",
          "partner",
        ]);
        expect(
          await legend.getByRole("listitem").evaluateAll((items) =>
            items.map((item) => ({
              label: item.textContent,
              color: getComputedStyle(item)
                .getPropertyValue("--nb-series-color")
                .trim()
                .toUpperCase(),
            })),
          ),
        ).toEqual([
          { label: "marketplace", color: "#F58518" },
          { label: "direct", color: "#4C78A8" },
          { label: "partner", color: "#E45756" },
        ]);
        return result;
      },
    );
    await flow.cold(
      "Reopen persisted chart and exact table",
      async (coldPage) => {
        await coldPage.goto(flow.url(notebook(projectId)));
        const saved = cell(coldPage, chartId);
        await expect(
          saved.getByRole("textbox", { name: "Chart title" }),
        ).toHaveValue(CHART_TITLE, LOAD);
        await (await chartMode(saved, "Table")).click();
        const table = saved.getByRole("table");
        const rows = table.getByRole("row");
        await expect(rows).toHaveCount(4);
        await expect(rows.nth(1)).toContainText(/Oct.*70/);
        await expect(rows.nth(2)).toContainText(/Nov.*84/);
        await expect(rows.nth(3)).toContainText(/Jan.*42/);
      },
    );
    await flow.rejectAction(
      "open-notebook-visualization-drill",
      {
        projectId,
        cellId: chartId,
        visualizationResultId: transform.visualizationResultId,
        selectionId: randomUUID(),
        mode: "view-data",
        requestId: randomUUID(),
      },
      /visualization_selection_invalid/,
    );
    await flow.readback(
      "Rejected selection leaves the chart artifact unchanged",
      async () => {
        expect(
          (await readyTransform(flow, projectId, chartId, "chart"))
            .visualizationResultId,
        ).toBe(transform.visualizationResultId);
      },
    );
    await flow.screenshot("monthly-chart");
    await flow.transition(
      "Rename the producer without losing its chart binding",
      async () => {
        const producer = cell(page, sqlId);
        await producer
          .getByRole("button", { name: "dataframe", exact: true })
          .click();
        const editor = producer.getByRole("textbox", {
          name: "Result variable name",
          exact: true,
        });
        await editor.fill("regional_sales");
        await editor.press("Enter");
        await expect(
          root.getByRole("combobox", { name: "DataFrame", exact: true }),
        ).toHaveText("regional_sales");
        await flow.open(notebook(projectId));
        expect(
          (await readyTransform(flow, projectId, chartId, "chart")).source
            .result.resultId,
        ).toBe(transform.source.result.resultId);
      },
    );
    const replacement = await seedSql(
      flow,
      projectId,
      CHART_REPLACEMENT_SQL,
      "chartReplacementCellId",
      chartId,
    );
    await flow.open(notebook(projectId));
    await flow.transition(
      "Rebind chart to an explicit 700 producer",
      async () => {
        await runSql(page, replacement, ["700"]);
        const document = await readProject(flow, projectId);
        const resultVariable = document.project.cells.find(
          (entry) => entry.id === replacement,
        )?.contents.resultVariable;
        if (typeof resultVariable !== "string")
          throw new Error("Replacement producer did not expose a variable");
        await chooseField(root, "DataFrame", resultVariable);
        await chartMode(root, "Table").click();
        await expect(
          root.getByRole("cell", { name: "700", exact: true }),
        ).toBeVisible(LOAD);
      },
    );
    await flow.readback(
      "Rebind changes both source and transform artifact IDs",
      async () => {
        const rebound = await readyTransform(flow, projectId, chartId, "chart");
        const current = await readCellExecution(flow, projectId, replacement);
        expect(rebound.source.result.resultId).toBe(current.resultId);
        expect(rebound.source.result.resultId).not.toBe(
          transform.source.result.resultId,
        );
        expect(rebound.visualizationResultId).not.toBe(
          transform.visualizationResultId,
        );
        expect(rebound.source.rowCount).toBe(1);
        expect(rebound.capped).toBe(false);
        expect(
          rebound.rows.map(({ x, series, value }) => [x, series, value]),
        ).toEqual([["2025-10-01", "direct", 700]]);
      },
    );
    await flow.screenshot("chart-rebound");
    await flow.transition(
      "Expose a complete empty chart and cap distinctly",
      async () => {
        const editor = editorOf(cell(page, replacement));
        await writeSqlEditor(editor, `${CHART_REPLACEMENT_SQL} where false`);
        await editor.press("ControlOrMeta+Enter");
        await expect(root.getByText("No data", { exact: true })).toBeVisible(
          HEALTHY,
        );
        const empty = await readVisualizationTransform(
          flow,
          projectId,
          chartId,
          "chart",
        );
        expect(empty.status).toBe("empty");
        expect(empty).toMatchObject({
          kind: "chart",
          source: { rowCount: 0 },
          rows: [],
        });
        const sourcePicker = cell(page, replacement).getByRole("button", {
          name: /^Data connection:/,
        });
        await sourcePicker.click();
        await page
          .getByRole("menuitemradio", { name: /^Dataframes\b/ })
          .click();
        await expect(sourcePicker).toHaveAccessibleName(
          "Data connection: Dataframes",
        );
        await writeSqlEditor(editor, CHART_CAP_SQL);
        await editor.press("ControlOrMeta+Enter");
        await expect(
          cell(page, replacement)
            .getByText(/^10,001 rows/)
            .first(),
        ).toBeVisible(HEALTHY);
        await chooseField(root, "Time unit", "None");
        await expect(
          root.getByText(/10,000.*(?:groups|marks)/).first(),
        ).toBeVisible(HEALTHY);
        const capped = await readyTransform(flow, projectId, chartId, "chart");
        expect(capped.source.rowCount).toBe(10_001);
        expect(capped.rows).toHaveLength(10_000);
        expect(capped.capped).toBe(true);
        const source = await readCellExecution(flow, projectId, replacement);
        expect(capped.source.result.resultId).toBe(source.resultId);
      },
    );
    await flow.screenshot("chart-cap");
  },
};

const pivot: FlowDefinition = {
  id: "08-pivot-drill",
  async run(flow) {
    const { page } = flow;
    const projectId = await seedNotebook(flow, "Pivot drill");
    const sqlId = await seedSql(flow, projectId, PIVOT_SOURCE);
    await flow.open(notebook(projectId));
    await flow.step("Run the four-row pivot producer", () =>
      runSql(page, sqlId, ["42", "8", "12", "84"]),
    );
    await flow.screenshot("pivot-source");
    const pivotId = await flow.transition(
      "Insert Pivot from the dataframe pill",
      () => insertFromPill(flow, sqlId, "Pivot dataframe"),
    );
    flow.id("pivotCellId", pivotId);
    const root = cell(page, pivotId);
    await flow.oracle("Check empty pivot zones, totals and modes", async () => {
      await expect(await chartMode(root, "Pivot")).toBeVisible();
      await expect(await chartMode(root, "Table")).toBeVisible();
      for (const name of [
        "Rows",
        "Columns",
        "Values",
        "Add row",
        "Add column",
        "Add value",
      ]) {
        await expect(
          root.getByText(name, { exact: true }).first(),
        ).toBeVisible();
      }
      await expect(
        root.getByRole("checkbox", { name: "Show row totals" }),
      ).toBeChecked();
      await expect(
        root.getByRole("checkbox", { name: "Show column totals" }),
      ).toBeChecked();
      await expect(
        root.getByRole("checkbox", { name: "Show subtotals" }),
      ).not.toBeChecked();
      await expect(
        root.getByRole("button", { name: /^Conditional formatting/ }),
      ).toBeDisabled();
    });
    const previousDrill = await flow.transition(
      "Build Region × Channel and drill into North/web",
      async () => {
        for (const [axis, field] of [
          ["Add row", "Region"],
          ["Add column", "Channel"],
          ["Add value", "Amount"],
        ] as const) {
          await choosePivotOption(page, root, axis, field);
        }
        await expect(
          root.getByText("Sum of Amount", { exact: true }),
        ).toBeVisible();
        const table = root.getByRole("table");
        const north = table.getByRole("row").filter({
          has: page.getByRole("rowheader", { name: "North", exact: true }),
        });
        for (const value of ["50", "12"]) {
          await expect(pivotValue(north, value)).toBeVisible();
        }
        const south = table.getByRole("row").filter({
          has: page.getByRole("rowheader", { name: "South", exact: true }),
        });
        await expect(
          south.getByRole("button", {
            name: "South, web, Sum of Amount, 84",
            exact: true,
          }),
        ).toBeVisible();
        await expect(pivotValue(table, "146")).toBeVisible();
        const selection = north.getByRole("button", {
          name: "North, web, Sum of Amount, 50",
          exact: true,
        });
        await selection.click();
        await expect(
          page.getByRole("menuitem", { name: "Drill down...", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("menuitem", { name: "Copy", exact: true }),
        ).toBeVisible();
        const [drillResponse] = await Promise.all([
          waitForAction(page, "open-notebook-visualization-drill"),
          page
            .getByRole("menuitem", { name: "View data", exact: true })
            .click(),
        ]);
        const originalRequest = visualizationDrillInputSchema.parse(
          drillResponse.request().postDataJSON(),
        );
        expect(originalRequest.selectionId).toBeTruthy();
        expect(originalRequest.visualizationResultId).toBeTruthy();
        expect(originalRequest).toMatchObject({
          projectId,
          cellId: pivotId,
          mode: "view-data",
          page: 1,
        });
        const drill = visualizationDrillOutputSchema.parse(
          await responseBody(drillResponse),
        );
        expect(drill.status).toBe("ready");
        const panel = root
          .getByRole("region", { name: /Viewing.*North.*web/ })
          .first();
        await expect(
          panel.getByRole("heading", { name: /Viewing.*North.*web/ }),
        ).toBeVisible();
        await expect(panel.getByText("2 rows", { exact: true })).toBeVisible();
        await flow.readback("View data contains just 42 and 8", async () => {
          const source = await readCellExecution(flow, projectId, sqlId);
          const result = visualizationDrillOutputSchema.parse(
            await flow.action(
              "open-notebook-visualization-drill",
              originalRequest,
            ),
          );
          expect(result).toEqual(drill);
          expect(result).toMatchObject({
            status: "ready",
            page: 1,
            totalRows: 2,
            resultId: source.resultId,
            filters: [
              { name: "Region", value: "North" },
              { name: "Channel", value: "web" },
            ],
            rows: [
              ["North", "web", "A", 42],
              ["North", "web", "B", 8],
            ],
          });
          if (result.status !== "ready")
            throw new Error("The Pivot detail is unreadable");
          flow.id("viewDataResultId", result.resultId);
        });
        await panel
          .getByRole("button", { name: "Close drill", exact: true })
          .click();
        await selection.click();
        await page
          .getByRole("menuitem", { name: "Drill down...", exact: true })
          .press("ArrowRight");
        await page
          .getByRole("menuitem", { name: "Product", exact: true })
          .click();
        const drilled = root
          .getByRole("region", { name: /Viewing.*North.*web/ })
          .first();
        await expect(
          drilled.getByText("Region = North", { exact: true }),
        ).toBeVisible();
        await expect(
          drilled.getByText("Channel = web", { exact: true }),
        ).toBeVisible();
        for (const [product, value] of [
          ["A", "42"],
          ["B", "8"],
        ] as const) {
          const row = drilled.getByRole("row").filter({
            has: page.getByRole("rowheader", { name: product, exact: true }),
          });
          await expect(
            row.getByRole("cell", { name: value, exact: true }),
          ).toBeVisible();
        }
        await page
          .getByRole("button", { name: "Drill up", exact: true })
          .click();
        await expect(selection).toBeVisible();
        await expect(selection).toBeFocused();
        await choosePivotOption(page, root, "Add value", "Amount");
        await choosePivotOption(page, root, "Sum of Amount", "Count", 1);
        await choosePivotOption(page, root, "As columns", "As rows");
        await expect(
          root.getByRole("combobox", { name: "As rows", exact: true }),
        ).toBeEnabled(LOAD);
        return originalRequest;
      },
    );
    const transform = await flow.readback(
      "Read matrix artifact and committed orientation",
      async () => {
        const stored = await readyTransform(flow, projectId, pivotId, "pivot");
        expect(stored.orientation).toBe("rows");
        if (!stored.visualizationResultId)
          throw new Error("Pivot has no matrix result");
        const source = await readCellExecution(flow, projectId, sqlId);
        expect(stored.source.result.resultId).toBe(source.resultId);
        expect(stored.source.rowCount).toBe(4);
        expect(stored.capped).toBe(false);
        flow.id("matrixResultId", stored.visualizationResultId);
        expect(pivotMatrixRows(stored)).toEqual(
          expect.arrayContaining([
            ["North", "web", 50, 2],
            ["North", "store", 12, 1],
            ["South", "web", 84, 1],
            ["Total", "Total", 146, 4],
          ]),
        );
        return stored;
      },
    );
    await flow.cold(
      "Reopen the persisted pivot including totals and orientation",
      async (coldPage) => {
        await coldPage.goto(flow.url(notebook(projectId)));
        const saved = cell(coldPage, pivotId);
        await expect(
          saved.getByRole("combobox", { name: "As rows", exact: true }),
        ).toBeVisible(LOAD);
        await expect(pivotValue(saved, "146")).toBeVisible();
        await expect(pivotValue(saved, "2").first()).toBeVisible();
      },
    );
    expect(previousDrill.visualizationResultId).not.toBe(
      transform.visualizationResultId,
    );
    await flow.rejecting(
      "Reject selection from the superseded Pivot",
      async () => {
        expect(
          visualizationDrillOutputSchema.parse(
            await flow.action("open-notebook-visualization-drill", {
              ...previousDrill,
              requestId: randomUUID(),
            }),
          ),
        ).toEqual({ status: "stale", reason: "result_superseded" });
      },
    );
    await flow.rejectAction(
      "open-notebook-visualization-drill",
      {
        projectId,
        cellId: pivotId,
        visualizationResultId: transform.visualizationResultId,
        selectionId: randomUUID(),
        mode: "view-data",
        requestId: randomUUID(),
      },
      /visualization_selection_invalid/,
    );
    expect(
      (await readyTransform(flow, projectId, pivotId, "pivot"))
        .visualizationResultId,
    ).toBe(transform.visualizationResultId);
    await flow.screenshot("pivot-matrix");
    await flow.transition(
      "Read non-additive totals from underlying amounts",
      async () => {
        let current = "Sum";
        for (const [aggregate, value] of [
          ["Avg", "36.5"],
          ["Median", "27"],
          ["Count distinct", "4"],
          ["Sum", "146"],
        ] as const) {
          await choosePivotOption(
            page,
            root,
            `${current} of Amount`,
            aggregate,
          );
          const total = root.getByRole("row").filter({
            has: page.getByRole("rowheader", { name: "Total", exact: true }),
          });
          await expect(pivotValue(total, value).first()).toBeVisible();
          current = aggregate;
        }
      },
    );
    await flow.transition(
      "Distinguish missing, exact zero and no source rows",
      async () => {
        const producer = cell(page, sqlId);
        const editor = editorOf(producer);
        const south = root.getByRole("row").filter({
          has: page.getByRole("rowheader", { name: "South", exact: true }),
        });
        await expect(pivotValue(south, "0")).toHaveCount(0);
        await writeSqlEditor(
          editor,
          `${PIVOT_SOURCE} union all select 'South', 'store', 'C', 0`,
        );
        await editor.press("ControlOrMeta+Enter");
        await expect(pivotValue(south, "0")).toBeVisible(HEALTHY);
        await writeSqlEditor(editor, `${PIVOT_SOURCE} where false`);
        await editor.press("ControlOrMeta+Enter");
        await expect(root.getByText("0 rows", { exact: true })).toBeVisible(
          HEALTHY,
        );
      },
    );
  },
};

type ReactiveExecution = {
  status: "found";
  autoRerun: boolean;
  reactivePending: boolean;
  snapshot: { inputRevision: string; ref: { eventSeq: string } };
  cells: Record<
    string,
    {
      stale: boolean;
      attempt: CellRunReceipt | null;
      resultId: string | null;
    }
  >;
};

async function readReactiveExecution(flow: FlowContext, projectId: string) {
  const execution = await flow.action<ReactiveExecution>(
    "get-notebook-execution",
    {
      projectId,
    },
  );
  expect(execution.status).toBe("found");
  return execution;
}

function waitForInputSave(page: Page, cellId: string) {
  return page.waitForResponse(
    (response) => inputSave(response.request(), cellId) !== undefined,
    HEALTHY,
  );
}

async function configureStaticOptions(
  flow: FlowContext,
  id: string,
  inputLabel: string,
  inputName: string,
) {
  const { page } = flow;
  const root = cell(page, id);
  const config = root.getByRole("button", {
    name: "Configure input",
    exact: true,
  });
  await flow.require(config, "Input configuration popover");
  await config.click();
  const settings = page.getByRole("dialog", {
    name: "Input settings",
    exact: true,
  });
  const staticOptions = settings.getByText("Static", { exact: true });
  const dynamicOptions = settings.getByText("Dynamic", { exact: true });
  await flow.require(staticOptions, "Static input options");
  await flow.require(dynamicOptions, "Dynamic input options");
  const label = settings.getByRole("textbox", { name: "Label", exact: true });
  const name = settings.getByRole("textbox", { name: "Name", exact: true });
  await expect(label).toHaveValue(/^Input \d+$/);
  await expect(name).toHaveValue(/^input_\d+$/);
  if (inputName === "region")
    await expect(
      settings.getByRole("checkbox", {
        name: "Allow users to clear selection",
        exact: true,
      }),
    ).not.toBeChecked();
  await staticOptions.click();
  await name.fill(inputName);
  await label.fill(inputLabel);
  const values = settings.getByRole("textbox", { name: "Values", exact: true });
  await values.fill(REGION_OPTIONS.join(", "));
  await expect(
    settings.getByRole("combobox", { name: "Data type" }),
  ).toHaveText("String");
  await expect(
    settings.getByRole("button", { name: "Clear all" }),
  ).toBeVisible();
  const [response] = await Promise.all([
    waitForInputSave(page, id),
    page.keyboard.press("Escape"),
  ]);
  const saved = await responseBody<{ project: Project }>(response);
  expect(
    saved.project.cells.find((entry) => entry.id === id)?.contents,
  ).toMatchObject({
    label: inputLabel,
    name: inputName,
    options: [...REGION_OPTIONS],
  });
}

async function configureRegion(flow: FlowContext, id: string) {
  await configureStaticOptions(flow, id, "Region", "region");
  const dropdown = valueForRegion(cell(flow.page, id));
  await expect(dropdown).toHaveText(REGION_OPTIONS[0]);
  await dropdown.click();
  await expect(flow.page.getByRole("listbox").getByRole("option")).toHaveText([
    ...REGION_OPTIONS,
  ]);
  await flow.page.keyboard.press("Escape");
  return dropdown;
}

function valueForRegion(root: Locator | Page) {
  return root.getByRole("combobox", { name: "Value for Region", exact: true });
}

async function chooseRegion(page: Page, dropdown: Locator, value: string) {
  await dropdown.click();
  await page
    .getByRole("listbox")
    .getByRole("option", { name: value, exact: true })
    .click();
}

function watchInputCommits(page: Page, cellId: string) {
  const submitted: string[] = [];
  const observe = (request: Request) => {
    const save = inputSave(request, cellId);
    if (save) submitted.push(save.contents.defaultValueString);
  };
  page.on("request", observe);
  return { submitted, stop: () => page.off("request", observe) };
}

async function runDebounceCheck(
  flow: FlowContext,
  projectId: string,
  kind: "Number input" | "Text input",
  expected:
    | { kind: "number"; value: number }
    | { kind: "string"; value: string },
  clockBoundary: 250 | 2000,
) {
  const { page } = flow;
  const id = await addFromBar(flow, kind);
  const root = cell(page, id);
  const initial = expected.kind === "number" ? "0" : "";
  const input = root.getByRole(
    expected.kind === "number" ? "spinbutton" : "textbox",
    { name: /^Value for / },
  );
  await expect(input).toHaveValue(initial);
  const commits = watchInputCommits(page, id);
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(now + 1000));
  try {
    await input.fill(String(expected.value));
    await page.clock.runFor(clockBoundary - 1);
    await expect(input).toBeFocused();
    expect(commits.submitted).toEqual([]);
    await page.clock.runFor(1);
    await expect
      .poll(() => commits.submitted)
      .toEqual([String(expected.value)]);
    await expect
      .poll(async () => {
        const { project } = await readProject(flow, projectId);
        return project.cells.find((entry) => entry.id === id)?.contents
          .defaultValueString;
      })
      .toBe(String(expected.value));
  } finally {
    commits.stop();
    await page.clock.resume();
  }
}

async function checkDiscreteCommits(flow: FlowContext, projectId: string) {
  const { page } = flow;
  const multiId = await addFromBar(flow, "Multiselect");
  await configureStaticOptions(flow, multiId, "Regions", "regions");
  const multi = cell(page, multiId).getByRole("button", {
    name: "Values for regions",
    exact: true,
  });
  await multi.click();
  const multiCommits = watchInputCommits(page, multiId);
  try {
    await page.getByRole("checkbox", { name: "North", exact: true }).check();
    await page.getByRole("checkbox", { name: "South", exact: true }).check();
    expect(multiCommits.submitted).toEqual([]);
    await page.keyboard.press("Escape");
    await expect
      .poll(() => multiCommits.submitted)
      .toEqual([JSON.stringify(REGION_OPTIONS)]);
    await expect
      .poll(async () => {
        const { project } = await readProject(flow, projectId);
        return project.cells.find((entry) => entry.id === multiId)?.contents
          .defaultValueString;
      })
      .toBe(JSON.stringify(REGION_OPTIONS));
  } finally {
    multiCommits.stop();
  }

  const sliderId = await addFromBar(flow, "Slider");
  const slider = cell(page, sliderId).getByRole("slider", {
    name: /^Value for /,
  });
  await expect(slider).toHaveValue("0");
  await expect(slider).toHaveAttribute("max", "10");
  const track = await slider.boundingBox();
  if (!track) throw new Error("Slider control has no geometry");
  const sliderCommits = watchInputCommits(page, sliderId);
  try {
    await page.mouse.move(track.x + 1, track.y + track.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      track.x + track.width - 1,
      track.y + track.height / 2,
      { steps: 12 },
    );
    await expect(slider).toHaveValue("10");
    expect(sliderCommits.submitted).toEqual([]);
    await page.mouse.up();
    await expect.poll(() => sliderCommits.submitted).toEqual(["10"]);
    await expect
      .poll(async () => {
        const { project } = await readProject(flow, projectId);
        return project.cells.find((entry) => entry.id === sliderId)?.contents
          .defaultValueString;
      })
      .toBe("10");
  } finally {
    sliderCommits.stop();
  }
}

const reactive: FlowDefinition = {
  id: "09-reactive-parameter",
  async run(flow) {
    const { page } = flow;
    const projectId = await seedNotebook(flow, "Reactive parameter");
    await flow.open(notebook(projectId));
    const inputId = await flow.transition(
      "Add a Region dropdown from Inputs",
      () => addFromBar(flow, "Dropdown"),
    );
    flow.id("inputCellId", inputId);
    await flow.screenshot("input-created");
    const dropdown = await flow.oracle(
      "Check naming, Static/Dynamic and first option defaults",
      () => configureRegion(flow, inputId),
    );
    const sqlId = await seedSql(flow, projectId, REGION_SQL());
    const independentId = await seedSql(
      flow,
      projectId,
      "select 999 as independent",
      "independentCellId",
    );
    await flow.open(notebook(projectId));
    await flow.transition("Run North and the unrelated SQL", async () => {
      await runSql(page, sqlId, ["62"]);
      await runSql(page, independentId, ["999"]);
    });
    const chartId = await flow.transition(
      "Bind a chart to the parameterized result",
      () => insertFromPill(flow, sqlId, "Visualize in chart"),
    );
    flow.id("chartCellId", chartId);
    const chartCell = cell(page, chartId);
    await chooseField(chartCell, "X-axis", "total");
    await chooseField(chartCell, "Y-axis", "total");
    const before = await readReactiveExecution(flow, projectId);
    expect(before.autoRerun).toBe(true);
    const unrelated = before.cells[independentId];
    const north = before.cells[sqlId];
    expect(unrelated?.attempt?.state.status).toBe("complete");
    expect(north?.attempt?.state.status).toBe("complete");
    expect(unrelated?.resultId).toBeTruthy();
    expect(north?.resultId).toBeTruthy();
    const runPosts: string[] = [];
    const observeRun = (request: Request) => {
      if (
        request.method() === "POST" &&
        /\/_agent-native\/actions\/start-notebook-run$/.test(
          new URL(request.url()).pathname,
        )
      )
        runPosts.push(request.url());
    };
    page.on("request", observeRun);
    try {
      await flow.transition(
        "Choose South and wait for automatic redraw of SQL and chart",
        async () => {
          const [response] = await Promise.all([
            waitForInputSave(page, inputId),
            chooseRegion(page, dropdown, "South"),
          ]);
          const saved = await responseBody<{ editStatus: string }>(response);
          expect(saved.editStatus).toBe("saved");
          expect(
            inputSave(response.request(), inputId)?.contents.defaultValueString,
          ).toBe("South");
          await expect(dropdown).toHaveText("South");
          await checkTable(page, sqlId, ["84"]);
          const tableMode = await chartMode(chartCell, "Table");
          await flow.require(tableMode, "Chart table for reactive output");
          await tableMode.click();
          await expect(
            chartCell.getByRole("cell", { name: "84", exact: true }).first(),
          ).toBeVisible(LOAD);
        },
      );
    } finally {
      page.off("request", observeRun);
    }
    expect(runPosts).toHaveLength(0);
    const after = await flow.readback(
      "Read South, saved SQL, result artifacts and unrelated attempt",
      async () => {
        const snapshot = await flow.action<NotebookSnapshot>(
          "get-notebook-snapshot",
          { projectId },
        );
        expect(snapshot.status).toBe("accepted");
        const persisted = snapshot.cells.find((entry) => entry.id === inputId);
        if (!persisted || persisted.contents.kind !== "input")
          throw new Error("Reactive input is absent");
        expect(persisted.contents).toMatchObject({
          name: "region",
          defaultValueString: "South",
          options: [...REGION_OPTIONS],
        });
        expect(
          snapshot.cells.find((entry) => entry.id === sqlId)?.contents,
        ).toMatchObject({ source: REGION_SQL() });
        const changes = await flow.action<{
          status: string;
          events: NotebookEvent[];
        }>("list-notebook-changes", {
          projectId,
          after: before.snapshot.ref.eventSeq,
        });
        expect(changes.status).toBe("ok");
        const change = changes.events.find(({ receipt }) =>
          receipt.delta.cells.some(
            ({ id, revision }) =>
              id === inputId && revision === persisted.revision,
          ),
        );
        expect(change?.runIntent?.kind).toBe("reactive-input");
        expect(
          change?.runIntent && [...change.runIntent.cellIds].sort(),
        ).toEqual([sqlId, chartId].sort());
        const execution = await readReactiveExecution(flow, projectId);
        expect(execution.reactivePending).toBe(false);
        expect(execution.cells[independentId]).toEqual(unrelated);
        const result = execution.cells[sqlId];
        if (!result?.resultId || !result.attempt || !unrelated?.resultId)
          throw new Error("Reactive or independent result is absent");
        expect(result.stale).toBe(false);
        expect(result.attempt.state.status).toBe("complete");
        expect(result.resultId).not.toBe(north?.resultId);
        const { runId, attemptId } = result.attempt.attempt;
        const savedRun = await flow.action<{
          status: string;
          run: NotebookRunReceipt;
        }>("get-notebook-run", { runId });
        expect(savedRun.status).toBe("found");
        expect(savedRun.run.request.requestId).toBe(
          `reactive:${execution.snapshot.inputRevision}`,
        );
        expect(
          savedRun.run.attempts.map(({ attempt }) => attempt.cellId),
        ).toEqual([sqlId]);
        expect(attemptId).not.toBe(north?.attempt?.attempt.attemptId);
        flow.id("reactiveRunId", runId);
        flow.id("reactiveSqlAttemptId", attemptId);
        for (const [resultId, expectedRows] of [
          [result.resultId, [[84]]],
          [unrelated.resultId, [[999]]],
        ] as const) {
          const artifact = await flow.action<{
            status: string;
            manifest: { status: string };
            rows: unknown[][];
          }>("get-notebook-result-page", { resultId, page: 1 });
          expect(artifact.status).toBe("ready");
          expect(artifact.manifest.status).toBe("complete");
          expect(artifact.rows).toEqual(expectedRows);
        }
        const diagnostics = await flow.action<{
          status: string;
          compiledSql: string;
          parameterCount: number;
          parameters: { name: string; type: string }[];
        }>("get-notebook-run-diagnostics", { runId, attemptId });
        expect(diagnostics.status).toBe("found");
        expect(diagnostics.compiledSql).toMatch(
          /where\s+region\s*=\s*cast\(\$[?1]\s+as\s+text\)/i,
        );
        expect(diagnostics.parameterCount).toBe(1);
        expect(diagnostics.parameters).toEqual([
          { name: "template_0", type: "STRING" },
        ]);
        return { execution, persisted };
      },
    );
    await flow.cold(
      "Reopen the saved South value and both runnable outputs",
      async (coldPage) => {
        await coldPage.goto(flow.url(notebook(projectId)));
        await expect(valueForRegion(cell(coldPage, inputId))).toHaveText(
          "South",
          LOAD,
        );
        await checkTable(coldPage, sqlId, ["84"]);
        await checkTable(coldPage, independentId, ["999"]);
      },
    );
    await flow.rejectAction(
      "save-project-cell",
      {
        projectId,
        cellId: inputId,
        expectedUpdatedAt: after.persisted.updatedAt,
        contents: { ...after.persisted.contents, defaultValueString: "East" },
      },
      /input_option_not_allowed/,
    );
    const afterReject = await readReactiveExecution(flow, projectId);
    expect(afterReject.snapshot.inputRevision).toBe(
      after.execution.snapshot.inputRevision,
    );
    expect(afterReject.cells[sqlId]).toEqual(after.execution.cells[sqlId]);
    expect(afterReject.cells[independentId]).toEqual(unrelated);
    expect(afterReject.reactivePending).toBe(false);
    await flow.screenshot("reactive-south");
    await flow.transition(
      "Auto-rerun off persists a value and leaves the dependent result stale",
      async () => {
        await page
          .getByRole("button", { name: "Run all options", exact: true })
          .click();
        const automatic = page.getByRole("menuitemcheckbox", {
          name: "Auto-rerun cells",
          exact: true,
        });
        await flow.require(automatic, "Notebook Auto-rerun control");
        await expect(automatic).toBeChecked();
        const [settingsResponse] = await Promise.all([
          waitForAction(page, "set-notebook-run-settings"),
          automatic.click(),
        ]);
        expect(await responseBody(settingsResponse)).toMatchObject({
          status: "saved",
          autoRerun: false,
        });
        const [response] = await Promise.all([
          waitForInputSave(page, inputId),
          chooseRegion(page, dropdown, "North"),
        ]);
        const saved = await responseBody<{
          project: Project;
          editStatus: string;
        }>(response);
        expect(saved.editStatus).toBe("saved");
        expect(
          saved.project.cells.find((entry) => entry.id === inputId)?.contents
            .defaultValueString,
        ).toBe("North");
        await expect(dropdown).toHaveText("North");
        await expect(
          cell(page, sqlId).getByText("Stale output", { exact: true }),
        ).toBeVisible();
        const stale = await readReactiveExecution(flow, projectId);
        expect(stale.autoRerun).toBe(false);
        expect(stale.reactivePending).toBe(false);
        expect(stale.cells[sqlId]?.stale).toBe(true);
        expect(stale.cells[sqlId]?.resultId).toBe(
          after.execution.cells[sqlId]?.resultId,
        );
        expect(stale.cells[independentId]).toEqual(unrelated);
        await runSql(page, sqlId, ["62"]);
        expect(
          (await readReactiveExecution(flow, projectId)).cells[sqlId]?.stale,
        ).toBe(false);
      },
    );
    await flow.oracle(
      "Check empty text and numeric zero with exact debounce boundaries",
      async () => {
        await page.clock.install();
        await runDebounceCheck(
          flow,
          projectId,
          "Number input",
          { kind: "number", value: 7 },
          250,
        );
        await runDebounceCheck(
          flow,
          projectId,
          "Text input",
          { kind: "string", value: "regional data" },
          2000,
        );
      },
    );
    await flow.oracle(
      "Check multiselect-close and slider-release commit boundaries",
      () => checkDiscreteCommits(flow, projectId),
    );
  },
};

type AppDocument = {
  settings: Record<string, unknown>;
  tabs: {
    name: string;
    rows: {
      columns: {
        left: number;
        right: number;
        elements: {
          cellId: string;
          heightPx: number;
          display: string;
          showLabel: boolean;
        }[];
      }[];
    }[];
  }[];
};

type Preview = PublishPreviewDetail;

type Release = {
  releaseId: string;
  head: unknown;
  manifestId: string;
  appHref: string;
  releaseHref: string;
};

type Session = AppSessionProjection;

async function completeAppResult(
  flow: FlowContext,
  resultId: string,
  scope: { previewId: string } | { sessionId: string },
  actor: "owner" | "colleague" = "owner",
) {
  const value = await flow.action<{
    status: string;
    manifest: { status: string };
    rows: unknown[][];
  }>("get-notebook-result-page", { resultId, page: 1, ...scope }, actor);
  expect(value.status).toBe("ready");
  expect(value.manifest.status).toBe("complete");
  return value;
}

async function seedCell(
  flow: FlowContext,
  projectId: string,
  input: Record<string, unknown>,
  details: Record<string, unknown>,
  key: string,
) {
  const added = await flow.action<{ project: Project; createdCellId: string }>(
    "add-project-cell",
    { projectId, ...input },
  );
  const stored = added.project.cells.find(
    (entry) => entry.id === added.createdCellId,
  );
  if (!stored) throw new Error(`App fixture ${key} is absent`);
  await flow.action("save-project-cell", {
    projectId,
    cellId: stored.id,
    contents: { ...stored.contents, ...details },
  });
  flow.id(key, stored.id);
  return stored.id;
}

function layoutPlacements(document: AppDocument) {
  return document.tabs.map(({ name, rows }) => ({
    name,
    rows: rows.map(({ columns }) =>
      columns.map(({ left, right, elements }) => ({
        left,
        right,
        elements: elements.map(({ cellId, heightPx, display, showLabel }) => ({
          cellId,
          heightPx,
          display,
          showLabel,
        })),
      })),
    ),
  }));
}

async function verifyAppTile(page: Page, title: string, expected: string) {
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible(
    HEALTHY,
  );
  await expect(page.getByText(expected, { exact: true }).first()).toBeVisible(
    HEALTHY,
  );
}

async function openPreview(
  flow: FlowContext,
  projectId: string,
  label: "Publish app" | "Publish changes",
) {
  const { page } = flow;
  const publish = page.getByRole("button", { name: label, exact: true });
  await flow.require(publish, label);
  let admitted: Response | undefined;
  const observePreview = (response: Response) => {
    if (
      new URL(response.url()).pathname.endsWith(
        "/_agent-native/actions/create-project-publish-preview",
      ) &&
      response.request().method() === "POST"
    )
      admitted = response;
  };
  page.on("response", observePreview);
  try {
    await publish.click();
    const previewTab = page.getByRole("tab", {
      name: "App preview",
      exact: true,
    });
    await flow.require(previewTab, "Publish app preview");
    await expect.poll(() => Boolean(admitted)).toBe(true);
  } finally {
    page.off("response", observePreview);
  }
  if (!admitted)
    throw new Error("Publish preview did not return an admission response");
  const { previewId } = await responseBody<{ previewId: string }>(admitted);
  expect(previewId).toBeTruthy();
  flow.id(label === "Publish app" ? "previewV1" : "previewV2", previewId);
  return waitForReadyPublishPreview(
    () => flow.action("get-project-publish-preview", { projectId, previewId }),
    HEALTHY.timeout,
  );
}

async function publishApp(
  flow: FlowContext,
  description: string,
  preview: Preview,
) {
  const dialog = flow.page.getByRole("dialog", {
    name: "Publish app",
    exact: true,
  });
  await dialog
    .getByPlaceholder("Provide an optional description for your version")
    .fill(description);
  const [response] = await Promise.all([
    waitForAction(flow.page, "publish-project"),
    dialog.getByRole("button", { name: /^Publish (?:app|changes)$/ }).click(),
  ]);
  const release = await responseBody<Release>(response);
  expect(release.releaseId).toBeTruthy();
  expect(release.manifestId).toBe(preview.manifestId);
  expect(release.head).toEqual(preview.head);
  await expect(
    flow.page.getByText("Published app link copied to clipboard.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    flow.page.getByRole("button", { name: "Publish changes", exact: true }),
  ).toBeDisabled();
  await expect(
    flow.page.getByRole("link", {
      name: "Go to live published app",
      exact: true,
    }),
  ).toBeVisible();
  return release;
}

async function valueInSession(
  flow: FlowContext,
  session: Session,
  sourceId: string,
  total: number,
  independentId: string,
) {
  const outputs = new Map(Object.entries(session.projection.outputs));
  const main = outputs.get(sourceId);
  const independent = outputs.get(independentId);
  if (!main?.resultId || !independent?.resultId)
    throw new Error("Session did not expose both pinned result artifacts");
  const scope = { sessionId: session.sessionId };
  const result = await completeAppResult(
    flow,
    main.resultId,
    scope,
    "colleague",
  );
  const unrelated = await completeAppResult(
    flow,
    independent.resultId,
    scope,
    "colleague",
  );
  expect(result.rows.map((row) => row.map(scalar))).toEqual([[total]]);
  expect(unrelated.rows.map((row) => row.map(scalar))).toEqual([[999]]);
}

function mountedHref(flow: FlowContext, href: string) {
  const mount = new URL(flow.baseUrl);
  const path = mount.pathname.replace(/\/$/, "");
  const url = new URL(href, mount);
  if (url.origin !== mount.origin)
    throw new Error("App link escapes the served origin");
  if (url.pathname.startsWith(`${path}/`)) return url.href;
  if (href.startsWith("/") && !href.startsWith("//")) return flow.url(href);
  throw new Error("App link escapes the mounted app");
}

async function grantViewerFixture(flow: FlowContext, projectId: string) {
  const owner = await flow.identity();
  const colleague = await flow.identity("colleague");
  if (
    owner.workspace.id !== colleague.workspace.id ||
    owner.user.id === colleague.user.id
  )
    flow.unavailable(
      "A separate signed-in colleague in the same workspace is required",
    );
  await flow.action("share-resource", {
    resourceType: "analytics-project",
    resourceId: projectId,
    principalType: "user",
    principalId: colleague.user.email,
    role: "viewer",
    notify: false,
  });
  flow.id("viewerId", colleague.user.id);
}

const publish: FlowDefinition = {
  id: "10-arrange-and-publish",
  async run(flow) {
    const { page } = flow;
    const title = "Regional revenue";
    const projectId = await seedNotebook(flow, "Arrange and publish");
    const textId = await seedCell(
      flow,
      projectId,
      { kind: "text" },
      { text: title },
      "narrativeCellId",
    );
    const inputId = await seedCell(
      flow,
      projectId,
      { kind: "input", inputType: "DROPDOWN", name: "region" },
      {
        label: "Region",
        options: [...REGION_OPTIONS],
        defaultValueString: "North",
      },
      "inputCellId",
    );
    const sourceId = await seedSql(flow, projectId, REGION_SQL());
    const chartId = await seedCell(
      flow,
      projectId,
      { kind: "chart", dataframe: "dataframe" },
      {
        chartSpec: {
          mark: "bar",
          stacked: true,
          title,
          xField: "total",
          yField: "total",
          seriesField: null,
        },
      },
      "chartCellId",
    );
    const independentId = await seedSql(
      flow,
      projectId,
      "select 999 as independent",
      "independentCellId",
    );
    expect((await readProject(flow, projectId)).outputs).toEqual({});
    await flow.open(notebook(projectId));
    await flow.transition(
      "Open Classic App builder on the never-run notebook",
      async () => {
        const entry = page
          .getByRole("navigation", { name: "Project views" })
          .getByText("App builder", { exact: true });
        await flow.require(entry, "App builder");
        await entry.click();
        const classic = page.getByText("Classic app", { exact: true });
        await flow.require(classic, "Classic app type");
        await classic.click();
        await page
          .getByRole("button", { name: "Edit app manually", exact: true })
          .click();
        await expect(
          page.getByText(title, { exact: true }).first(),
        ).toBeVisible(LOAD);
      },
    );
    await flow.screenshot("classic-builder");
    await flow.oracle(
      "Check default membership and display/run settings",
      async () => {
        await page
          .getByRole("button", { name: "Outline", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Reset layout", exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "App settings", exact: true })
          .click();
        for (const [name, checked] of [
          ["Full width", false],
          ["Table of contents", true],
          ["Metadata", true],
          ["Run from scratch on load", false],
          ["Auto-refresh published results", true],
          ["Auto-rerun cells", true],
        ] as const) {
          await expect(
            page.getByRole("checkbox", { name, exact: true }),
          ).toBeChecked({ checked });
        }
        await expect(page.getByText("24 hours", { exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
      },
    );
    await flow.transition(
      "Arrange the input and chart in one row, then add Details",
      async () => {
        const chartDrag = page
          .getByRole("button", { name: "Hold to drag element", exact: true })
          .last();
        await flow.require(chartDrag, "App element drag control");
        const from = await chartDrag.boundingBox();
        if (!from) throw new Error("Chart drag control has no geometry");
        const input = valueForRegion(page);
        const onto = await input.boundingBox();
        if (!onto) throw new Error("Input placement has no geometry");
        await page.mouse.move(
          from.x + from.width / 2,
          from.y + from.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
          onto.x + onto.width / 2,
          onto.y + onto.height / 2,
          { steps: 12 },
        );
        const inputRow = page.locator("[data-app-row]").filter({ has: input });
        await expect(
          inputRow.getByText("Add to row", { exact: true }),
        ).toBeVisible();
        await page.mouse.up();
        await expect(
          inputRow.getByRole("button", {
            name: "Row elements are already distributed and resized equally",
            exact: true,
          }),
        ).toBeDisabled();
        const inputTile = inputRow
          .locator(".nb-app-grid-card")
          .filter({ has: input });
        const width = inputTile.getByRole("button", {
          name: "Increase width",
          exact: true,
        });
        await flow.require(width, "Width snap control");
        const resizeSteps = 3;
        for (let step = 0; step < resizeSteps; step++) {
          await expect(width).toBeEnabled();
          await width.press("ArrowLeft");
        }
        const joinedChart = inputRow.getByRole("region", {
          name: "Chart 4",
          exact: true,
        });
        await fillAppLayoutGap(
          joinedChart.getByRole("button", {
            name: "Layout for Chart 4",
            exact: true,
          }),
          page.getByRole("menuitem", { name: "Move left", exact: true }),
          joinedChart.getByRole("button", {
            name: "Increase width",
            exact: true,
          }),
          resizeSteps,
        );
        const addTab = page.getByRole("button", {
          name: "Add tab",
          exact: true,
        });
        await flow.require(addTab, "App layout tabs");
        await addTab.click();
        await expect(
          page.getByRole("tab", { name: "Tab 1", exact: true }),
        ).toBeVisible();
        await page
          .getByRole("textbox", { name: "Tab name", exact: true })
          .fill("Details");
        await page
          .getByRole("textbox", { name: "Tab name", exact: true })
          .press("Enter");
        await expect(
          page.getByRole("tab", { name: "Tab 1", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        await page.getByRole("tab", { name: "Details", exact: true }).click();
        const chartOutline = page
          .getByRole("complementary", { name: "Outline" })
          .getByRole("listitem")
          .filter({ hasText: "Chart 4" });
        await chartOutline
          .getByRole("button", { name: "Add to App builder", exact: true })
          .click();
        const chartTile = page.getByRole("region", {
          name: "Chart 4",
          exact: true,
        });
        const height = chartTile.getByRole("button", {
          name: "Increase height",
          exact: true,
        });
        for (let step = 0; step < 2; step++) {
          await expect(height).toBeEnabled();
          await height.press("Enter");
        }
        await chartTile
          .getByRole("button", { name: "Layout for Chart 4", exact: true })
          .click();
        await page
          .getByRole("menuitemcheckbox", { name: "Show label", exact: true })
          .click();
      },
    );
    const preview = await flow.transition(
      "Open publish preview and run default inputs",
      () => openPreview(flow, projectId, "Publish app"),
    );
    await flow.readback(
      "Compare exact layout and unrun draft preview outputs",
      async () => {
        if (!preview.project.appLayout)
          throw new Error("The preview did not pin an app layout");
        const placements = layoutPlacements(preview.project.appLayout);
        expect(placements).toEqual([
          {
            name: "Tab 1",
            rows: [
              [
                {
                  left: 0,
                  right: 120,
                  elements: [
                    expect.objectContaining({
                      cellId: textId,
                      display: "output",
                    }),
                  ],
                },
              ],
              [
                {
                  left: 0,
                  right: 45,
                  elements: [
                    expect.objectContaining({
                      cellId: inputId,
                      display: "output",
                    }),
                  ],
                },
                {
                  left: 45,
                  right: 120,
                  elements: [
                    {
                      cellId: chartId,
                      heightPx: 220,
                      display: "output",
                      showLabel: true,
                    },
                  ],
                },
              ],
            ],
          },
          {
            name: "Details",
            rows: [
              [
                {
                  left: 0,
                  right: 120,
                  elements: [
                    {
                      cellId: chartId,
                      heightPx: 320,
                      display: "output",
                      showLabel: false,
                    },
                  ],
                },
              ],
            ],
          },
        ]);
        expect(preview.compareReleaseId).toBeNull();
        const main = preview.outputs.find(({ cellId }) => cellId === sourceId);
        const independent = preview.outputs.find(
          ({ cellId }) => cellId === independentId,
        );
        if (!main?.resultId || !independent?.resultId)
          throw new Error(
            "Preview did not expose both complete result artifacts",
          );
        const scope = { previewId: preview.previewId };
        const result = await completeAppResult(flow, main.resultId, scope);
        expect(result.rows.map((row) => row.map(scalar))).toEqual([[62]]);
        const companion = await completeAppResult(
          flow,
          independent.resultId,
          scope,
        );
        expect(companion.rows.map((row) => row.map(scalar))).toEqual([[999]]);
      },
    );
    await flow.oracle("Check first-publish Notebook diff", async () => {
      await page
        .getByRole("tab", { name: "Notebook diff", exact: true })
        .click();
      await expect(
        page.getByText("Added", { exact: true }).first(),
      ).toBeVisible();
      await page.getByRole("tab", { name: "App preview", exact: true }).click();
    });
    const v1 = await flow.transition(
      "Publish First release from the ready preview",
      () => publishApp(flow, "First release", preview),
    );
    flow.id("releaseV1", v1.releaseId);
    flow.id("manifestV1", v1.manifestId);
    await flow.step(
      "Grant the separate workspace fixture reader app access",
      () => grantViewerFixture(flow, projectId),
    );
    const getSession = (sessionId: string, releaseId: string) =>
      flow.action<Session>(
        "get-published-app-session",
        { sessionId, releaseId },
        "colleague",
      );
    let pinnedV1: Session | undefined;
    await flow.cold(
      "Open a fresh pinned app session from the served link",
      async (reader) => {
        const starts: string[] = [];
        reader.on("request", (request) => {
          if (
            /\/actions\/(start-notebook-run|run-published-project-cell)$/.test(
              new URL(request.url()).pathname,
            ) &&
            request.method() === "POST"
          ) {
            starts.push(request.url());
          }
        });
        const opened = waitForAction(reader, "open-published-app-session");
        await reader.goto(mountedHref(flow, v1.appHref));
        const session = await responseBody<Session>(await opened);
        expect(session.releaseId).toBe(v1.releaseId);
        expect(session.baselineManifestId).toBe(v1.manifestId);
        await verifyAppTile(reader, title, "62");
        await reader.setViewportSize({ width: 390, height: 240 });
        const app = reader.locator("[data-published-app='true']");
        const tabList = app.getByRole("tablist", { name: "Tabs" });
        const firstTab = tabList.getByRole("tab", {
          name: "Tab 1",
          exact: true,
        });
        const details = tabList.getByRole("tab", {
          name: "Details",
          exact: true,
        });
        await expect(firstTab).toHaveAttribute("aria-selected", "true");
        await firstTab.press("ArrowRight");
        await expect(details).toBeFocused();
        await expect(details).toHaveAttribute("aria-selected", "true");
        await expect
          .poll(() => new URL(reader.url()).searchParams.get("tab"))
          .toBe("details");
        await details.press("ArrowLeft");
        await expect(firstTab).toBeFocused();
        await expect(firstTab).toHaveAttribute("aria-selected", "true");
        await expect
          .poll(() => new URL(reader.url()).searchParams.has("tab"))
          .toBe(false);

        const scrolled = await app.evaluate((element) => {
          element.scrollTop = element.scrollHeight - element.clientHeight;
          return element.scrollTop;
        });
        expect(scrolled).toBeGreaterThan(16);
        await expect
          .poll(() =>
            tabList.evaluate((element) => {
              const header = element.closest("main")?.querySelector("header");
              if (!header) throw new Error("Published header is missing");
              return Math.round(
                element.getBoundingClientRect().top -
                  header.getBoundingClientRect().bottom,
              );
            }),
          )
          .toBe(0);
        expect(starts).toEqual([]);
        flow.id("sessionV1", session.sessionId);
        pinnedV1 = session;
      },
      "colleague",
    );
    if (!pinnedV1) throw new Error("Live v1 session did not return its pin");
    const pinned = pinnedV1;
    await flow.open(notebook(projectId));
    await writeSqlEditor(editorOf(cell(page, sourceId)), REGION_SQL(10));
    const narrative = cell(page, textId);
    await narrative
      .getByRole("button", { name: "Edit Text 1", exact: true })
      .click();
    const narrativeEditor = editorOf(narrative);
    await expect(narrativeEditor).toBeFocused();
    await narrativeEditor.fill("Regional revenue v2");
    await narrativeEditor.press("Tab");
    await expect(
      narrative.getByText("Regional revenue v2", { exact: true }),
    ).toBeVisible();
    const v2Preview = await openPreview(flow, projectId, "Publish changes");
    expect(v2Preview.compareReleaseId).toBe(v1.releaseId);
    expect(
      v2Preview.project.cells.find(({ id }) => id === sourceId)?.contents,
    ).toMatchObject({ source: REGION_SQL(10) });
    expect(
      v2Preview.project.cells.find(({ id }) => id === textId)?.contents,
    ).toMatchObject({ text: "Regional revenue v2" });
    const v2 = await publishApp(flow, "Second release", v2Preview);
    expect(v2.releaseId).not.toBe(v1.releaseId);
    flow.id("releaseV2", v2.releaseId);
    expect(
      (await readProject(flow, projectId)).project.publishedVersionId,
    ).toBe(v2.releaseId);
    await flow.rejectAction(
      "publish-project",
      {
        projectId,
        previewId: v2Preview.previewId,
        expectedHead: v2Preview.head,
        expectedReleaseId: v1.releaseId,
        expectedManifestRevision: v2Preview.manifestRevision,
        requestId: randomUUID(),
        mode: "ready",
      },
      /publish_release_changed/,
    );
    expect(
      (await readProject(flow, projectId)).project.publishedVersionId,
    ).toBe(v2.releaseId);
    await flow.rejectAction(
      "get-published-app-session",
      {
        sessionId: pinned.sessionId,
        releaseId: v2.releaseId,
      },
      /session_release_mismatch/,
      "colleague",
    );
    await flow.cold(
      "Reopen pinned v1 and confirm v2 latest is separate",
      async (reader) => {
        await reader.goto(mountedHref(flow, pinned.sessionHref));
        await verifyAppTile(reader, title, "62");
        const sessionBefore = await getSession(pinned.sessionId, v1.releaseId);
        const sessionLayout = sessionBefore.appDocument;
        const previewLayout = preview.project.appLayout;
        if (!sessionLayout || !previewLayout)
          throw new Error(
            "The session or preview is missing its pinned layout",
          );
        expect(sessionLayout).toEqual(
          sessionBefore.projection.project.appLayout,
        );
        expect(layoutPlacements(sessionLayout)).toEqual(
          layoutPlacements(previewLayout),
        );
        await valueInSession(flow, sessionBefore, sourceId, 62, independentId);
        await chooseRegion(reader, valueForRegion(reader), "South");
        await verifyAppTile(reader, title, "84");
        const changed = await getSession(pinned.sessionId, v1.releaseId);
        await valueInSession(flow, changed, sourceId, 84, independentId);
        expect(changed.projection.outputs[independentId]).toEqual(
          sessionBefore.projection.outputs[independentId],
        );
        await reader
          .getByRole("button", {
            name: "Reset 1 input and return to default view",
            exact: true,
          })
          .click();
        await verifyAppTile(reader, title, "62");
        const reset = await getSession(pinned.sessionId, v1.releaseId);
        expect(reset.projection.outputs[sourceId]).toEqual(
          sessionBefore.projection.outputs[sourceId],
        );
        const openedV2 = waitForAction(reader, "open-published-app-session");
        await reader.goto(mountedHref(flow, v2.appHref));
        const latest = await responseBody<Session>(await openedV2);
        expect(latest.releaseId).toBe(v2.releaseId);
        await verifyAppTile(reader, "Regional revenue v2", "620");
        await valueInSession(
          flow,
          await getSession(latest.sessionId, v2.releaseId),
          sourceId,
          620,
          independentId,
        );
        await flow.screenshot("latest-v2", reader);
      },
      "colleague",
    );
  },
};

export const flows06To10: FlowDefinition[] = [
  python,
  chart,
  pivot,
  reactive,
  publish,
];
