import { randomUUID } from "node:crypto";

import {
  expect,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";
import { z } from "zod";

import { projectDocumentSchema } from "../../app/lib/model/contracts.js";
import { dataBrowserCatalogOutputSchema } from "../../app/lib/model/data-catalog-contracts.js";
import { dataTableDetailsSchema } from "../../app/lib/model/data-table-contracts.js";
import { creationReceiptSchema } from "../../shared/notebook-creation.js";
import {
  executionSnapshotSchema,
  runReceiptSchema,
} from "../../shared/notebook-execution.js";
import { kernelVariableSchema } from "../../shared/notebook-kernel-output.js";
import { notebookSnapshotActionReadSchema } from "../../shared/notebook-snapshot-read.js";
import { queryNotebookTableReceiptSchema } from "../../shared/notebook-table-query.js";
import { warehouseTableProvenanceSchema } from "../../shared/warehouse-table.js";
import { connectionDialog, field } from "../daily/setup.helpers.js";
import { readSqlEditor, writeSqlEditor } from "../sql-editor.js";
import {
  holdCreationReceipt,
  newProjectShortcut,
  notebookCreateViewer,
  pressHomeNewProjectShortcut,
} from "./creation-receipt.js";
import { withHeldDraftQuery } from "./draft-query-hold.js";
import {
  dependencyFingerprint,
  evidenceRowsSchema as savedRowsSchema,
  readAttempt,
  readCompletedResultPage,
  readRunAttempts,
} from "./execution-readback.js";
import { settleHeldRoute } from "./held-route.js";
import { attestKernel } from "./kernel-attestation.js";
import type { ActionFailure, FlowContext, FlowDefinition } from "./runtime.js";
import {
  controlWarehouseEntitlement,
  createWarehouseEntitlementProject,
} from "./warehouse-entitlement.js";
import { warehouseProjectNotFound } from "./warehouse-feedback.js";
import {
  catalogFixtures,
  catalogFixtureWarehouse,
  connections,
  demo,
  fillCredential,
  fixtureWarehouse,
  invalidCredential,
  openBigQuery,
  project,
  readWarehouseCredential,
  refreshWarehouseCatalog,
  saveWarehouse,
  warehouseCellRunIntent,
  warehouseFaultFixture,
  warehouseName,
  warehouseOption,
  warehouseQueries,
  type Source,
} from "./warehouse-fixtures.js";

const id = z.string().min(1);
const revision = z.string().regex(/^(0|[1-9][0-9]*)$/);
const timeout = { timeout: 30_000 };
const paths = {
  create: "**/_agent-native/actions/create-project",
  save: /\/_agent-native\/actions\/(apply-notebook-operation|save-project-cell)$/,
};
const actionName = (url: string) => new URL(url).pathname.split("/").at(-1);
const notebook = (projectId: string) =>
  `/project/${encodeURIComponent(projectId)}/latest`;
const cells = (page: Page) => page.locator("[data-notebook-cell]");
const sqlEditor = (cell: Locator) =>
  cell.getByRole("textbox", { name: /^Edit SQL/ });
const output = (cell: Locator) => cell.locator(".nb-table");
const rowCells = (cell: Locator) => output(cell).locator("tbody tr > td");
const sourcePicker = (cell: Locator) =>
  cell.getByRole("button", { name: /^Data connection:/ });

const projectRead = z.object({
  project: projectDocumentSchema,
  viewer: z.object({ orgId: id, email: id }),
});
type Rows = z.infer<typeof savedRowsSchema>;

function gate() {
  let release: () => void = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

async function seedNotebook(flow: FlowContext, label: string) {
  const { id: projectId } = z
    .object({ id })
    .parse(await flow.action("create-project", { title: flow.name(label) }));
  flow.id("project", projectId);
  return projectId;
}

async function addSql(flow: FlowContext) {
  const index = await cells(flow.page).count();
  const add = flow.page
    .getByRole("group", { name: "Add code cell" })
    .getByRole("button", { name: "Query", exact: true })
    .last();
  await flow.require(add, "Add SQL cell");
  await add.click();
  const cell = cells(flow.page).nth(index);
  await expect(cell).toBeVisible(timeout);
  return cell;
}

async function chooseSource(flow: FlowContext, cell: Locator, source: Source) {
  await sourcePicker(cell).click();
  await flow.require(
    warehouseOption(flow.page, source),
    `Select ${source.name}`,
  );
  await warehouseOption(flow.page, source).click();
}

async function selectSource(flow: FlowContext, cell: Locator, source: Source) {
  await chooseSource(flow, cell, source);
  await expect(sourcePicker(cell)).toHaveAccessibleName(
    `Data connection: ${source.name}`,
  );
}

async function dataBrowser(flow: FlowContext, page: Page, source: Source) {
  const browser = page.getByRole("button", {
    name: "Data browser",
    exact: true,
  });
  await flow.require(browser, "Notebook Data browser");
  await browser.click();
  const panel = page.locator('aside[aria-label="Data browser"]');
  await panel
    .getByRole("combobox", { name: "Data connection" })
    .selectOption(source.id);
  return panel;
}

function datasetButton(panel: Locator, dataset: string) {
  return panel.getByRole("button", { name: `${dataset} schema`, exact: true });
}

async function tableInDataset(
  flow: FlowContext,
  source: Source,
  dataset: string,
  table: string,
) {
  const datasetPage = z.object({ items: z.array(z.object({ id, name: id })) });
  const roots = datasetPage.parse(
    await flow.action("list-connection-datasets", {
      connectionId: source.id,
      search: dataset,
    }),
  );
  const root = roots.items.find((item) => item.name === dataset);
  if (!root) flow.unavailable(`Warehouse fixture dataset ${dataset} is absent`);
  const tables = datasetPage.parse(
    await flow.action("list-connection-datasets", {
      connectionId: source.id,
      parentId: root.id,
      search: table,
    }),
  );
  const item = tables.items.find((value) => value.name === table);
  if (!item)
    flow.unavailable(`Warehouse fixture table ${dataset}.${table} is absent`);
  return item.id;
}

function numericRows(rows: Rows) {
  return rows.map((row) =>
    row.map((value) =>
      typeof value === "object" &&
      value !== null &&
      (value.type === "int64" || value.type === "integer")
        ? Number(value.value)
        : value,
    ),
  );
}

async function verifyRows(cell: Locator, expected: (string | number)[][]) {
  await expect(output(cell).locator("tbody tr")).toHaveCount(
    expected.length,
    timeout,
  );
  await expect(rowCells(cell)).toHaveText(expected.flat().map(String), timeout);
}

async function observeRun(
  flow: FlowContext,
  cell: Locator,
  bypassCache = false,
) {
  const operation = "start-notebook-run";
  const run = cell.getByRole("button", { name: /^Run SQL/ });
  await flow.require(run, "Run SQL");
  const [request] = await Promise.all([
    flow.page.waitForRequest((value) =>
      [operation, "run-project-cell"].includes(actionName(value.url()) ?? ""),
    ),
    bypassCache
      ? sqlEditor(cell).press("ControlOrMeta+Shift+Enter")
      : run.click(),
  ]);
  if (actionName(request.url()) !== operation) flow.missing(operation);
  return request;
}

async function admittedRun(
  flow: FlowContext,
  request: Request,
  targetCell: Locator,
) {
  const response = await request.response();
  if (!response?.ok())
    throw new Error(`Run admission HTTP ${response?.status() ?? "missing"}`);
  const receipt = runReceiptSchema.parse(await response.json());
  const cellId = id.parse(await targetCell.getAttribute("data-notebook-cell"));
  const read = () => storedAttempt(flow, receipt.runId, cellId);
  await expect
    .poll(async () => (await read()).state.status, timeout)
    .toBe("complete");
  const completed = await read();
  expect(completed.attempt).toEqual(
    receipt.attempts.find(({ attempt }) => attempt.cellId === cellId)?.attempt,
  );
  if (completed.state.status !== "complete")
    throw new Error("Notebook attempt is not complete");
  expect(completed.state.resultIds).toHaveLength(1);
  const resultId = id.parse(completed.state.resultIds[0]);
  const runKey = receipt.runId.replace(/[^a-zA-Z0-9_-]/g, "_");
  flow.id(`run_${runKey}`, receipt.runId);
  flow.id(`attempt_${runKey}`, completed.attempt.attemptId);
  flow.id(`result_${runKey}`, resultId);
  return {
    ...completed.attempt,
    run: completed.run,
    events: completed.events,
    resultId,
  };
}

async function storedAttempt(flow: FlowContext, runId: string, cellId: string) {
  return readAttempt(
    await flow.action("get-notebook-run", { runId }),
    runId,
    cellId,
  );
}

async function readResultPage(
  flow: FlowContext,
  resultId: string,
  page: number,
  count: string,
) {
  return readCompletedResultPage(
    await flow.action("get-notebook-result-page", { resultId, page }),
    page,
    count,
    resultId,
  );
}

async function completedWarehouseAttempt(
  flow: FlowContext,
  runId: string,
  cellId: string,
) {
  async function readCompleted() {
    const { attempt, run, state } = await storedAttempt(flow, runId, cellId);
    expect(run.plan.admittedCellIds).toEqual([cellId]);
    if (state.status === "failed" || state.status === "cancelled")
      throw new Error(`Warehouse run ended with ${state.status}`);
    if (state.status !== "complete") return null;
    expect(state.resultIds).toHaveLength(1);
    return {
      attemptId: attempt.attemptId,
      resultId: id.parse(state.resultIds[0]),
    };
  }
  await expect.poll(readCompleted, timeout).not.toBeNull();
  const completed = await readCompleted();
  if (!completed) throw new Error("The warehouse result is absent");
  return completed;
}

async function warehouseResultPage(
  flow: FlowContext,
  attempt: { attemptId: string; resultId: string },
  page: number,
  count: number,
) {
  const result = await readResultPage(
    flow,
    attempt.resultId,
    page,
    String(count),
  );
  expect(result.manifest.result.producer.attemptId).toBe(attempt.attemptId);
  return {
    manifest: result.manifest,
    rows: result.rows.map((row) =>
      row.map((value) =>
        typeof value === "object" && value !== null && value.type === "integer"
          ? { type: "int64" as const, value: value.value }
          : value,
      ),
    ),
  };
}

async function notebookWarehouseQuery(
  flow: FlowContext,
  source: Source,
  query: (typeof warehouseQueries)[number],
  bypassCache = false,
) {
  const cell = await addSql(flow);
  await selectSource(flow, cell, source);
  await writeSqlEditor(sqlEditor(cell), query.sql);
  const start = await observeRun(flow, cell, bypassCache);
  const response = await start.response();
  if (!response?.ok())
    throw new Error(
      `Warehouse admission HTTP ${response?.status() ?? "missing"}`,
    );
  const receipt = runReceiptSchema.parse(await response.json());
  if (bypassCache) expect(receipt.request.cache).toBe("bypass");
  const cellId = id.parse(await cell.getAttribute("data-notebook-cell"));
  const attempt = await completedWarehouseAttempt(flow, receipt.runId, cellId);
  const [rows, columns] = query.dimensions;
  await expect(output(cell).locator("tbody tr")).toHaveCount(rows, timeout);
  const table = output(cell);
  await expect(
    table.getByRole("columnheader", { name: "Row number", exact: true }),
  ).toHaveCount(1, timeout);
  await expect(table.getByRole("columnheader")).toHaveCount(
    columns + 1,
    timeout,
  );
  const saved = await warehouseResultPage(flow, attempt, 1, rows);
  expect(saved.manifest.fields).toHaveLength(columns);
  expect(saved.rows).toHaveLength(rows);
  if (query.rows) {
    await verifyRows(cell, query.rows);
    expect(numericRows(saved.rows)).toEqual(query.rows);
  }
  return { rows: saved.rows, runId: receipt.runId, ...attempt };
}

async function editWarehouse(flow: FlowContext, source: Source) {
  await flow.open("/settings/data-sources");
  const row = flow.page.locator(
    `[data-rid="settings.data-sources.connections.item"][data-rid-key=${JSON.stringify(source.id)}]`,
  );
  await expect(row.getByText(source.name, { exact: true })).toBeVisible(
    timeout,
  );
  const options = row.getByRole("button", {
    name: `${source.name} options`,
    exact: true,
  });
  const edit = row.getByRole("button", { name: "Edit", exact: true });
  await expect(options.or(edit)).toBeVisible(timeout);
  if (await options.isVisible()) {
    await options.click();
    await row.getByRole("menuitem", { name: "Edit", exact: true }).click();
  } else {
    await edit.click();
  }
  const dialog = connectionDialog(flow.page);
  await expect(field(dialog, /^Datasets/)).toBeVisible();
  return dialog;
}

async function updateWarehouse(
  flow: FlowContext,
  dialog: Locator,
  shouldSucceed = true,
) {
  const [response] = await Promise.all([
    flow.page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        ["update-workspace-warehouse-form", "save-data-connection"].includes(
          actionName(res.url()) ?? "",
        ),
    ),
    dialog
      .getByRole("button", { name: "Update connection", exact: true })
      .click(),
  ]);
  expect(response.ok()).toBe(shouldSucceed);
  if (shouldSucceed) await expect(dialog).toBeHidden();
}

const connectWarehouse: FlowDefinition = {
  id: "01-connect-warehouse",
  async run(flow) {
    const connectionName = flow.name(warehouseName);
    const dialog = await flow.step(
      "Open mounted BigQuery connection form",
      () => openBigQuery(flow),
    );
    const storage = dialog.getByRole("switch", {
      name: "Use BigQuery Storage API",
      exact: true,
    });
    await flow.oracle("BigQuery fields; Storage on and Drive off", async () => {
      await expect(field(dialog, /^Name/)).toBeVisible();
      await expect(field(dialog, /^Project ID/)).toBeVisible();
      await expect(
        field(dialog, /^Service account configuration/),
      ).toHaveAttribute("type", "password");
      await expect(storage).toBeChecked();
      await expect(
        dialog.getByRole("switch", { name: "Enable Google Drive Access" }),
      ).not.toBeChecked();
    });

    const credential = await readWarehouseCredential(flow);
    const projectIdField = field(dialog, /^Project ID/);
    const test = dialog.getByRole("button", {
      name: "Test connection",
      exact: true,
    });
    async function checkKey(
      projectId: string,
      key: string,
      status: number,
      message: string,
    ) {
      await projectIdField.fill(projectId);
      await fillCredential(dialog, key);
      const [response] = await Promise.all([
        flow.page.waitForResponse(
          (res) => actionName(res.url()) === "test-data-connection",
        ),
        test.click(),
      ]);
      expect(response.status()).toBe(status);
      await expect(dialog.getByText(message, { exact: true })).toBeVisible();
    }
    const before = new Set((await connections(flow)).map((entry) => entry.id));
    try {
      await flow.rejecting(
        "Reject wrong project and invalid service-account key",
        async () => {
          await checkKey(
            "a2-parity-nonexistent-v2-fixture",
            credential,
            404,
            warehouseProjectNotFound,
          );
          await checkKey(
            project,
            invalidCredential(credential),
            422,
            "Google rejected the service account key. Check that it is valid and active.",
          );
          expect(
            (await connections(flow)).map((entry) => entry.id).sort(),
          ).toEqual([...before].sort());
        },
      );
      await flow.transition("Valid Test → saved warehouse", async () => {
        await checkKey(
          project,
          credential,
          200,
          "BigQuery dataset access verified.",
        );
        await saveWarehouse(flow.page, dialog, connectionName, credential);
      });
    } finally {
      if (await dialog.isVisible()) {
        await fillCredential(dialog, "");
        await dialog
          .getByRole("button", { name: "Close", exact: true })
          .click();
      }
    }
    const created = (await connections(flow)).find(
      (entry) => entry.name === connectionName && !before.has(entry.id),
    );
    if (!created)
      throw new Error(
        "Created warehouse is absent from the stored connection list",
      );
    flow.id("connection", created.id);
    const formSchema = z.object({
      values: z.object({ projectId: id, useBQStorageAPI: z.boolean() }),
    });
    const form = () =>
      flow
        .action("get-data-connection-form", { id: created.id })
        .then((data) => formSchema.parse(data));
    await flow.readback(
      "Persisted connection configuration and catalog table identities",
      async () => {
        expect((await form()).values).toMatchObject({
          projectId: project,
          useBQStorageAPI: true,
        });
        for (const [dataset, table, rowCount, columnCount] of [
          ["a2_parity", "customers", "500", 5],
          ["a2_parity", "orders", "20000", 6],
          ["a2_parity_east", "events", "5000", 4],
        ] as const) {
          const tableId = await tableInDataset(flow, created, dataset, table);
          flow.id(`${dataset}_${table}`, tableId);
          const details = dataTableDetailsSchema.parse(
            await flow.action("get-data-table-details", {
              connectionId: created.id,
              tableId,
            }),
          );
          expect(details).toMatchObject({
            connectionId: created.id,
            table: {
              projectId: project,
              datasetId: dataset,
              tableId: table,
              numRows: rowCount,
              columnCount,
            },
          });
        }
      },
    );

    const projectId = await seedNotebook(flow, "Warehouse evidence");
    await flow.cold(
      "Reopen notebook and inspect authorized catalog",
      async (page) => {
        await page.goto(flow.url(notebook(projectId)));
        const panel = await dataBrowser(flow, page, created);
        await expect(datasetButton(panel, "a2_parity")).toBeVisible(timeout);
        await expect(datasetButton(panel, "a2_parity_east")).toBeVisible(
          timeout,
        );
      },
    );
    await flow.open(notebook(projectId));
    await flow.oracle(
      "Warehouse picker grouping, selected marker and default source",
      async () => {
        const cell = await addSql(flow);
        const defaultSource = (await connections(flow)).find(
          (entry) => entry.isDefault,
        );
        if (defaultSource) {
          await expect(sourcePicker(cell)).toHaveAccessibleName(
            `Data connection: ${defaultSource.name}`,
          );
        }
        await selectSource(flow, cell, created);
        await sourcePicker(cell).click();
        for (const heading of [
          "IMPORTED WORKSPACE CONNECTIONS",
          "AVAILABLE WORKSPACE CONNECTIONS",
          "Add a data connection",
        ]) {
          await flow.require(
            flow.page.getByText(heading, { exact: true }),
            heading,
          );
        }
        await expect(warehouseOption(flow.page, created)).toHaveAttribute(
          "aria-checked",
          "true",
        );
        await flow.page.keyboard.press("Escape");
      },
    );

    const tableId = await tableInDataset(
      flow,
      created,
      "a2_parity",
      "customers",
    );
    const authority = warehouseTableProvenanceSchema.parse(
      await flow.action("get-notebook-table-reference", {
        connectionId: created.id,
        tableId,
      }),
    );
    expect(authority.connectionId).toBe(created.id);
    flow.id("authorityGeneration", authority.authorityGeneration);
    const resultsByTransport: Rows[][] = [];
    for (const enabled of [true, false]) {
      await flow.transition(
        enabled
          ? "Run the four Storage sentinels"
          : "Run the four REST sentinels",
        async () => {
          if (!enabled) {
            const edit = await editWarehouse(flow, created);
            await edit
              .getByRole("switch", {
                name: "Use BigQuery Storage API",
                exact: true,
              })
              .uncheck();
            await updateWarehouse(flow, edit);
            expect((await form()).values.useBQStorageAPI).toBe(false);
            await flow.open(notebook(projectId));
          }
          const rows: Rows[] = [];
          for (const query of warehouseQueries)
            rows.push(
              (await notebookWarehouseQuery(flow, created, query)).rows,
            );
          resultsByTransport.push(rows);
        },
      );
    }
    expect(resultsByTransport[0]).toEqual(resultsByTransport[1]);

    await flow.rejecting(
      "Dataset filter rejects nonexistent names and preserves stored catalog",
      async () => {
        const edit = await editWarehouse(flow, created);
        await field(edit, /^Datasets/).fill("no_such_dataset_01");
        await updateWarehouse(flow, edit, false);
        const rejection = edit.locator(".data-connection-error");
        await expect(rejection).toHaveText(
          "Dataset no_such_dataset_01 could not be verified. Check its name and access.",
        );
        await expect(rejection).toBeVisible();
        await edit.getByRole("button", { name: "Close", exact: true }).click();
        await tableInDataset(flow, created, "a2_parity_east", "events");
      },
    );
    await flow.transition(
      "Dataset filter narrows the catalog and clearing restores it",
      async () => {
        const datasetList = z.object({
          items: z.array(z.object({ name: id })),
        });
        const list = () =>
          flow
            .action("list-connection-datasets", {
              connectionId: created.id,
              search: "a2_parity_east",
            })
            .then((data) =>
              datasetList.parse(data).items.map((item) => item.name),
            );
        for (const datasets of ["a2_parity", ""]) {
          const edit = await editWarehouse(flow, created);
          await field(edit, /^Datasets/).fill(datasets);
          await updateWarehouse(flow, edit);
          await expect
            .poll(list, timeout)
            .toEqual(datasets ? [] : ["a2_parity_east"]);
        }
      },
    );
    await using fixture = await warehouseFaultFixture(flow, created.id);
    await flow.transition(
      "Storage failure preserves results through the same REST job",
      async () => {
        const edit = await editWarehouse(flow, created);
        await edit
          .getByRole("switch", {
            name: "Use BigQuery Storage API",
            exact: true,
          })
          .check();
        await updateWarehouse(flow, edit);
        expect((await form()).values.useBQStorageAPI).toBe(true);
        await flow.open(notebook(projectId));
        const before = await fixture.calls();
        await fixture.patch({ bigqueryStorageFailure: true });
        try {
          const query = warehouseQueries[0];
          if (!query) throw new Error("LIMIT 50 fixture is absent");
          const saved = await notebookWarehouseQuery(
            flow,
            created,
            query,
            true,
          );
          expect(saved.rows).toEqual(resultsByTransport[0]?.[0]);
          expect(
            await flow.action("get-notebook-run-diagnostics", {
              runId: saved.runId,
              attemptId: saved.attemptId,
            }),
          ).toMatchObject({
            status: "found",
            diagnostic: {
              code: "complete",
              fallbackCode: "warehouse_query_failed",
              fallbackProvider: {
                reason: expect.stringMatching(
                  /^(grpc_\d+|warehouse_query_failed)$/,
                ),
              },
            },
          });
          const trace = (await fixture.calls()).slice(before.length);
          const submissions = trace.filter(
            (call) =>
              call.method === "POST" &&
              /\/projects\/[^/]+\/(jobs|queries)(?:\?|$)/.test(call.path),
          );
          expect(submissions).toHaveLength(1);
          const storage = trace.filter((call) => call.host === "storage");
          expect(storage).toHaveLength(1);
          const jobId = id.parse(storage[0]?.jobId);
          const submittedJob = submissions[0]?.jobId;
          if (submittedJob !== undefined) expect(submittedJob).toBe(jobId);
          expect(
            trace.some(
              (call) =>
                call.method === "GET" &&
                call.path.split("?")[0]?.endsWith(`/queries/${jobId}`),
            ),
          ).toBe(true);
          flow.id("fallbackProviderJob", jobId);
        } finally {
          await fixture.patch({ bigqueryStorageFailure: false });
        }
      },
    );
    await flow.readback(
      "Distinguish last good catalog from a verified empty catalog",
      async () => {
        const catalog = () =>
          flow
            .action("get-data-browser-catalog", { connectionId: created.id })
            .then((data) => dataBrowserCatalogOutputSchema.parse(data));
        const refresh = () => refreshWarehouseCatalog(flow, created.id);
        await refresh();
        await expect
          .poll(async () => (await catalog()).refreshState, timeout)
          .toBe("ready");
        const lastGood = await catalog();
        expect(lastGood.resources.map((item) => item.name)).toEqual(
          expect.arrayContaining(["a2_parity", "a2_parity_east"]),
        );
        expect(lastGood.lastRefreshed).not.toBeNull();
        try {
          await fixture.patch({ bigquery: "error" });
          await expect(refresh()).rejects.toMatchObject({
            action: "refresh-data-browser-catalog",
            status: 502,
          } satisfies Partial<ActionFailure>);
          await expect
            .poll(async () => (await catalog()).refreshState, timeout)
            .toMatch(/^(stale|failed)$/);
          expect(await catalog()).toMatchObject({
            hasSuccessfulSnapshot: true,
            resources: lastGood.resources,
            lastRefreshed: lastGood.lastRefreshed,
            refreshError: { code: "data_catalog_refresh_failed" },
          });
          await fixture.patch({ bigquery: "empty" });
          await refresh();
          await expect
            .poll(async () => {
              const read = await catalog();
              return [read.refreshState, read.resources.length];
            }, timeout)
            .toEqual(["ready", 0]);
        } finally {
          await fixture.patch({ bigquery: "ok" });
          await refresh();
          await expect
            .poll(async () => {
              const read = await catalog();
              return [
                read.refreshState,
                read.resources.map((node) => node.id).sort(),
              ];
            }, timeout)
            .toEqual([
              "ready",
              lastGood.resources.map((node) => node.id).sort(),
            ]);
        }
      },
    );
    if (!flow.actorStateAvailable("denied"))
      flow.unavailable(
        "Warehouse authority rejection requires a distinct denied storage state",
      );
    const beforeDenied = (await fixture.calls()).length;
    await flow.rejectAction(
      "list-connection-datasets",
      { connectionId: created.id },
      /data_connection_forbidden|connection_forbidden|connection_not_found/,
      "denied",
    );
    expect(await fixture.calls()).toHaveLength(beforeDenied);
  },
};

const catalogTableToQuery: FlowDefinition = {
  id: "02-catalog-table-to-query",
  async run(flow) {
    if (!flow.bqKeyFile)
      flow.unavailable(
        "The two exact BigQuery catalog fixtures require --bq-key-file",
      );
    const source = await flow.step("Open the two-region BigQuery fixture", () =>
      catalogFixtureWarehouse(flow),
    );
    const projectId = await seedNotebook(flow, "Catalog query evidence");
    await flow.open(notebook(projectId));
    const panel = await dataBrowser(flow, flow.page, source);
    const results: { cellId: string; firstPage: Rows; sql: string }[] = [];
    for (const [index, fixture] of catalogFixtures.entries()) {
      const receipt = await flow.transition(
        `Preview ${fixture.dataset}.customers → one insert and admitted run`,
        async () => {
          await datasetButton(panel, fixture.dataset).click();
          await panel
            .getByRole("button", { name: /^customers\s+table$/ })
            .click();
          await flow.oracle(
            "Typed columns and Preview before Query",
            async () => {
              await expect(
                panel.getByRole("tab", { name: "Preview", exact: true }),
              ).toBeVisible();
              await expect(
                panel.getByRole("tab", { name: /^Columns/ }),
              ).toBeVisible();
            },
          );
          const query = panel.getByRole("button", {
            name: /^(Query|Adding query…)$/,
          });
          await flow.require(query, "Catalog Query");
          const pattern = "**/_agent-native/actions/query-notebook-table";
          const held = gate();
          const writes: Request[] = [];
          const record = (request: Request) => {
            if (actionName(request.url()) === "query-notebook-table")
              writes.push(request);
          };
          flow.page.on("request", record);
          await flow.page.route(pattern, async (route) => {
            await held.wait;
            await settleHeldRoute(() => route.continue());
          });
          try {
            const [request] = await Promise.all([
              flow.page.waitForRequest((value) =>
                ["query-notebook-table", "add-project-cell"].includes(
                  actionName(value.url()) ?? "",
                ),
              ),
              query.click(),
            ]);
            if (actionName(request.url()) !== "query-notebook-table")
              flow.missing("query-notebook-table");
            if (index === 0 && (await query.isEnabled())) await query.click();
            held.release();
            const response = await request.response();
            if (!response?.ok())
              throw new Error(
                `Catalog admission HTTP ${response?.status() ?? "missing"}`,
              );
            const body = queryNotebookTableReceiptSchema.parse(
              await response.json(),
            );
            expect(
              writes.map((write) => write.postDataJSON().requestId),
            ).toEqual([body.requestId]);
            return body;
          } finally {
            held.release();
            await flow.page.unroute(pattern);
            flow.page.off("request", record);
          }
        },
      );
      const expectedSql = `select * from \`${project}.${fixture.dataset}.customers\` limit 100`;
      expect(receipt.sql).toBe(expectedSql);
      expect(receipt.sourceId).toBe(source.id);
      expect(receipt.table.connectionId).toBe(source.id);
      const tableId = await tableInDataset(
        flow,
        source,
        fixture.dataset,
        "customers",
      );
      expect(receipt.table.tableId).toBe(tableId);
      flow.id(`table_${fixture.dataset}`, tableId);
      flow.id(`run_${fixture.dataset}`, receipt.runId);
      flow.id(`cell_${fixture.dataset}`, receipt.cellId);
      const cell = cells(flow.page).nth(index);
      await expect(cell).toHaveAttribute("data-notebook-cell", receipt.cellId);
      await expect(cell).toBeInViewport();
      await expect.poll(() => readSqlEditor(sqlEditor(cell))).toBe(expectedSql);
      await expect(
        cell.getByText(receipt.resultVariable, { exact: true }),
      ).toBeVisible();
      await expect(output(cell).locator("tbody tr")).toHaveCount(50, timeout);

      const run = await flow.readback(
        "Read admitted run, stored source and both full result pages",
        async () => {
          const attempt = await completedWarehouseAttempt(
            flow,
            receipt.runId,
            receipt.cellId,
          );
          flow.id(`result_${fixture.dataset}`, attempt.resultId);
          const first = await warehouseResultPage(flow, attempt, 1, 100);
          const second = await warehouseResultPage(flow, attempt, 2, 100);
          for (const result of [first, second]) {
            expect(result.rows).toHaveLength(50);
            expect(result.manifest.result.sourceGeneration).toBe(
              receipt.table.authorityGeneration,
            );
          }
          const rows = [...first.rows, ...second.rows];
          expect(
            numericRows(rows).sort((a, b) =>
              String(a[0]).localeCompare(String(b[0])),
            ),
          ).toEqual(fixture.rows);
          const stored = projectRead.parse(
            await flow.action("get-project", { projectId }),
          );
          expect(stored.project.cells[index]).toMatchObject({
            id: receipt.cellId,
            contents: {
              source: expectedSql,
              dataConnectionId: source.id,
              resultVariable: receipt.resultVariable,
              warehouseTable: receipt.table,
            },
          });
          return {
            cellId: receipt.cellId,
            firstPage: first.rows,
            sql: expectedSql,
          };
        },
      );
      results.push(run);
      const payload = { table: { ...receipt.table, connectionId: demo.id } };
      const before = projectRead.parse(
        await flow.action("get-project", { projectId }),
      );
      const snapshot = notebookSnapshotActionReadSchema.parse(
        await flow.action("get-notebook-snapshot", { projectId }),
      );
      if (snapshot.status !== "accepted")
        throw new Error("Catalog query has no accepted notebook snapshot");
      await flow.rejectAction(
        "query-notebook-table",
        {
          projectId,
          workingVersionId: before.project.workingVersionId,
          observedHead: snapshot.snapshot.head,
          requestId: randomUUID(),
          cellId: randomUUID(),
          afterCellId: receipt.cellId,
          expectedOrderRevision: snapshot.resources.orderRevision,
          throughOperationIds: [],
          ...payload,
        },
        /table_query_denied|table_not_found/,
        "owner",
        { uiOnly: true },
      );
      expect(
        projectRead.parse(await flow.action("get-project", { projectId }))
          .project.cells,
      ).toEqual(before.project.cells);
      await panel.getByRole("button", { name: "Go back", exact: true }).click();
      await panel
        .getByRole("button", { name: "All datasets", exact: true })
        .click();
    }
    expect(results[0]?.cellId).not.toBe(results[1]?.cellId);
    await flow.cold(
      "Open from a new context and verify original result order",
      async (page) => {
        await page.goto(flow.url(notebook(projectId)));
        for (const [index, result] of results.entries()) {
          const cell = cells(page).nth(index);
          await expect(cell).toHaveAttribute(
            "data-notebook-cell",
            result.cellId,
          );
          await expect
            .poll(() => readSqlEditor(sqlEditor(cell)))
            .toBe(result.sql);
          await verifyRows(
            cell,
            numericRows(result.firstPage).map((row) =>
              row.map((value) =>
                typeof value === "number" ? value : String(value),
              ),
            ),
          );
        }
      },
    );
  },
};

const createNotebook: FlowDefinition = {
  id: "03-create-notebook",
  async run(flow) {
    const titlePrefix = "Parity 03 – Revenue 42";
    const title = flow.name(titlePrefix);
    const titleSlug = `parity-03-revenue-42-${title.slice(titlePrefix.length + 1)}`;
    const workspace = z
      .object({ workspace: z.object({ id }), user: z.object({ email: id }) })
      .parse(await flow.action("get-workspace-bootstrap"));
    const creation = z.object({
      status: z.literal("committed"),
      receipt: z.object({
        requestId: z.uuid(),
        projectId: id,
        workingVersionId: id,
        href: id,
      }),
    });
    await flow.open("/home");
    let create = flow.page.getByRole("button", {
      name: "New project",
      exact: true,
    });
    if (!(await create.isVisible())) {
      const menu = flow.page.getByRole("button", {
        name: "Create new",
        exact: true,
      });
      await flow.require(menu, "Home New project entry");
      await menu.click();
      create = flow.page.getByRole("menuitem", {
        name: "New project",
        exact: true,
      });
    }
    await flow.require(create, "Home New project");
    const held = gate();
    const receiptGate = await holdCreationReceipt(flow.page);
    const writes: Request[] = [];
    await flow.page.route(paths.create, async (route) => {
      writes.push(route.request());
      if (writes.length === 1) {
        const response = await route.fetch();
        await held.wait;
        await settleHeldRoute(() =>
          response.ok() ? route.abort("failed") : route.fulfill({ response }),
        );
      } else {
        await settleHeldRoute(() => route.continue());
      }
    });
    let requestId: string | undefined;
    try {
      await flow.transition(
        "New project opens a provisional notebook and recovers a lost acknowledgment",
        async () => {
          await create.click();
          const namingDialog = flow.page.getByRole("dialog", {
            name: "New project",
            exact: true,
          });
          const creating = flow.page.getByText("Creating project…", {
            exact: true,
          });
          await creating.or(namingDialog).first().waitFor({ state: "visible" });
          if (await namingDialog.isVisible())
            flow.missing(
              "Direct Home notebook creation without a naming dialog",
            );
          await expect(flow.page).toHaveURL(flow.url("/home"));
          await expect.poll(() => writes.length).toBe(1);
          const input = z
            .object({ requestId: z.uuid() })
            .safeParse(writes[0]?.postDataJSON());
          if (!input.success)
            return flow.missing("Revisioned project creation intent");
          requestId = input.data.requestId;
          flow.id("creationIntent", requestId);
          await flow.page.keyboard.press(newProjectShortcut);
          if ((await create.isVisible()) && (await create.isEnabled()))
            await create.click();
          expect(writes).toHaveLength(1);
          await flow.oracle(
            "Provisional Untitled project starts with an empty title input",
            async () => {
              await flow.page
                .getByText("Untitled project", { exact: true })
                .click();
              const name = flow.page.getByRole("textbox", {
                name: "Project title",
                exact: true,
              });
              await expect(name).toHaveValue("");
              await name.fill(title);
              await name.press("Enter");
            },
          );
          held.release();
          await expect(
            flow.page.getByText("Checking whether the project was created…", {
              exact: true,
            }),
          ).toBeVisible();
          receiptGate.release();
          await expect(flow.page).toHaveURL(
            /\/project\/[^/]+\/latest/,
            timeout,
          );
          await expect(flow.page.locator(".nb-project-title")).toHaveText(
            title,
            timeout,
          );
          expect(
            writes.every(
              (write) => write.postDataJSON().requestId === requestId,
            ),
          ).toBe(true);
        },
      );
    } finally {
      held.release();
      await receiptGate.dispose();
      await flow.page.unroute(paths.create);
    }
    if (!requestId) throw new Error("Project creation intent is absent");
    const { projectId } = await flow.readback(
      "Creation receipt, owner, workspace, lineage and committed title",
      async () => {
        const stored = creation.parse(
          await flow.action("get-project-creation", { requestId }),
        );
        const receipt = stored.receipt;
        expect(receipt.requestId).toBe(requestId);
        expect(new URL(flow.page.url()).pathname).toContain(
          notebook(receipt.projectId),
        );
        flow.id("project", receipt.projectId);
        flow.id("workingVersion", receipt.workingVersionId);
        const read = projectRead.parse(
          await flow.action("get-project", { projectId: receipt.projectId }),
        );
        expect(read.viewer).toEqual({
          orgId: workspace.workspace.id,
          email: workspace.user.email,
        });
        expect(read.project).toMatchObject({
          id: receipt.projectId,
          title,
          ownerEmail: workspace.user.email,
          workingVersionId: receipt.workingVersionId,
          cells: [],
        });
        const versions = z
          .object({
            versions: z.array(
              z.object({ id, number: id, isWorking: z.boolean() }),
            ),
          })
          .parse(
            await flow.action("list-project-versions", {
              projectId: receipt.projectId,
            }),
          );
        expect(
          versions.versions.filter((version) => version.isWorking),
        ).toEqual([
          { id: receipt.workingVersionId, number: "1", isWorking: true },
        ]);
        const snapshot = z
          .object({ metadataRevision: revision, slug: id })
          .parse(
            await flow.action("get-notebook-snapshot", {
              projectId: receipt.projectId,
            }),
          );
        expect(snapshot).toEqual({
          metadataRevision: "1",
          slug: titleSlug,
        });
        const list = z
          .object({ projects: z.array(z.object({ id, title: id })) })
          .parse(await flow.action("list-projects", { search: title }));
        expect(list.projects.filter((item) => item.title === title)).toEqual([
          { id: receipt.projectId, title },
        ]);
        return receipt;
      },
    );
    await flow.oracle(
      "Notebook, Agent and App builder tabs; Notebook selected",
      async () => {
        const tabs = flow.page.getByRole("navigation", {
          name: "Project views",
        });
        await expect(
          tabs.getByRole("button", { name: "Notebook", exact: true }),
        ).toHaveAttribute("aria-current", "page");
        await expect(
          tabs.getByRole("button", { name: "Agent", exact: true }),
        ).toBeVisible();
        await expect(
          tabs.getByRole("button", { name: "App builder", exact: true }),
        ).toBeVisible();
        await expect(flow.page).toHaveTitle(`${title} (Editing)`);
      },
    );
    await flow.cold(
      "Open the sole Projects link and reload the accepted notebook",
      async (page) => {
        await page.goto(flow.url("/home/all"));
        const link = page
          .getByRole("main")
          .getByRole("link", { name: title, exact: true });
        await expect(link).toBeVisible(timeout);
        await link.click();
        await expect(page).toHaveURL(flow.url(notebook(projectId)));
        await page.reload();
        await expect(page.locator(".nb-project-title")).toHaveText(
          title,
          timeout,
        );
      },
    );
    await flow.rejectAction(
      "create-project",
      { requestId, title: "Different creation intent" },
      /creation_intent_reused/,
    );
    await flow.oracle(
      "A duplicate placeholder gains the next suffix",
      async () => {
        const seeded = creationReceiptSchema.parse(
          await flow.action("create-project", { requestId: randomUUID() }),
        );
        const prior = /^Untitled project(?: \((\d+)\))?$/.exec(
          seeded.snapshot.metadata.title,
        );
        if (!prior) throw new Error("Seeded placeholder title is unreadable");
        const next = Number(prior[1] ?? "1") + 1;
        await flow.open("/home");
        await pressHomeNewProjectShortcut(flow.page);
        await expect(flow.page.locator(".nb-project-title")).toHaveText(
          `Untitled project (${next})`,
          timeout,
        );
      },
    );
    const viewer = await notebookCreateViewer(flow);
    const denied = z
      .object({ features: z.object({ canCreateProject: z.literal(false) }) })
      .parse(await flow.action("get-workspace-bootstrap", {}, viewer));
    expect(denied.features.canCreateProject).toBe(false);
    await flow.rejectAction(
      "create-project",
      { requestId: randomUUID(), title: "Denied parity 03" },
      /project_create_denied/,
      viewer,
    );
  },
};

const idsAndSentinel = (page: number, sentinel: number) =>
  Array.from({ length: 50 }, (_, index) => [
    50 * (page - 1) + index + 1,
    sentinel,
  ]);

async function changePage(flow: FlowContext, cell: Locator, page: number) {
  const goTo = cell.getByRole("button", { name: "Go to page", exact: true });
  await flow.require(goTo, "Go to page");
  await goTo.click();
  const field = flow.page.getByRole("spinbutton", {
    name: "Go to page",
    exact: true,
  });
  await field.fill(String(page));
  await field.press("Enter");
}

async function failedRun(flow: FlowContext, request: Request, cell: Locator) {
  const response = await request.response();
  if (!response?.ok())
    throw new Error(`Run admission HTTP ${response?.status() ?? "missing"}`);
  const { runId } = runReceiptSchema.parse(await response.json());
  const cellId = id.parse(await cell.getAttribute("data-notebook-cell"));
  const read = () => storedAttempt(flow, runId, cellId);
  await expect
    .poll(async () => (await read()).state.status, timeout)
    .toBe("failed");
  const { attempt } = await read();
  flow.id("failedRun", runId);
  flow.id("failedAttempt", attempt.attemptId);
  return { runId, attemptId: attempt.attemptId };
}

async function rejectRevokedSqlSource(flow: FlowContext) {
  const actor = await notebookCreateViewer(flow);
  const { user } = await flow.identity(actor);
  const { fixtureId, connectionId } = z
    .object({ fixtureId: z.uuid(), connectionId: id })
    .parse(
      await controlWarehouseEntitlement(flow, {
        operation: "warehouse-create-entitlement",
        colleagueEmail: user.email,
      }),
    );
  const projectId = await createWarehouseEntitlementProject(
    flow,
    flow.name("SQL source denial evidence"),
    [
      {
        label: "Warehouse source",
        source: "select max(sentinel) as sentinel from a2_parity.sql_v2_04",
        dataConnectionId: connectionId,
        resultVariable: "warehouse_source",
      },
    ],
  );
  await flow.action("share-resource", {
    resourceType: "analytics-project",
    resourceId: projectId,
    principalType: "user",
    principalId: user.email,
    role: "editor",
    notify: false,
  });
  const execution = () =>
    flow.action("get-notebook-execution", { projectId }, actor);
  const before = await execution();
  const { snapshot, cells } = z
    .object({
      status: z.literal("found"),
      snapshot: executionSnapshotSchema,
      activeRunIds: z.tuple([]),
      cells: z.record(id, z.object({ resultId: z.null() })),
    })
    .parse(before);
  const cellId = id.parse(Object.keys(cells)[0]);
  const intent = warehouseCellRunIntent({
    requestId: randomUUID(),
    snapshot,
    targetCellId: cellId,
    cache: "bypass",
  });
  try {
    expect(
      await controlWarehouseEntitlement(flow, {
        operation: "warehouse-revoke-entitlement",
        fixtureId,
      }),
    ).toEqual({ fixtureId, entitled: false });
    await flow.rejecting(
      "Revoked source is denied before SQL admission",
      async () => {
        expect(await flow.action("start-notebook-run", intent, actor)).toEqual({
          status: "denied",
          reason: "access_denied",
        });
        expect(await execution()).toEqual(before);
      },
    );
  } finally {
    expect(
      await controlWarehouseEntitlement(flow, {
        operation: "warehouse-restore-entitlement",
        fixtureId,
      }),
    ).toEqual({ fixtureId, entitled: true });
  }
  await flow.readback(
    "Restored source admits the same SQL intent",
    async () => {
      const restored = runReceiptSchema.parse(
        await flow.action("start-notebook-run", intent, actor),
      );
      expect(restored.plan.admittedCellIds).toEqual([cellId]);
      const read = async () =>
        readAttempt(
          await flow.action(
            "get-notebook-run",
            { runId: restored.runId },
            actor,
          ),
          restored.runId,
          cellId,
        );
      await expect
        .poll(async () => (await read()).state.status, timeout)
        .toBe("complete");
      const { state } = await read();
      if (state.status !== "complete")
        throw new Error("Restored SQL did not complete");
      const resultId = id.parse(state.resultIds[0]);
      const page = readCompletedResultPage(
        await flow.action(
          "get-notebook-result-page",
          { resultId, page: 1 },
          actor,
        ),
        1,
        "1",
        resultId,
      );
      expect(numericRows(page.rows)).toEqual([[42]]);
    },
  );
}

const writeRunSql: FlowDefinition = {
  id: "04-write-run-sql",
  async run(flow) {
    const withBigQuery = Boolean(flow.bqKeyFile);
    const oldSource = withBigQuery
      ? await fixtureWarehouse(flow, "a2_parity_v2_old")
      : demo;
    const source = withBigQuery
      ? await fixtureWarehouse(flow, "a2_parity")
      : demo;
    const projectId = await seedNotebook(flow, "SQL run evidence");
    await flow.open(notebook(projectId));
    const cell = await addSql(flow);
    await selectSource(flow, cell, oldSource);
    const editor = sqlEditor(cell);
    await flow.oracle("Auto default and SQL cell placeholder", async () => {
      await flow.page
        .getByRole("button", { name: "Run all options", exact: true })
        .click();
      await flow.page
        .getByRole("menuitem", { name: "Run mode", exact: true })
        .press("ArrowRight");
      await expect(
        flow.page.getByRole("menuitemradio", { name: "Auto", exact: true }),
      ).toHaveAttribute("aria-checked", "true");
      await flow.page.keyboard.press("Escape");
      await flow.page.keyboard.press("Escape");
      await expect.poll(() => readSqlEditor(editor)).toBe("");
      await expect(
        cell.getByRole("button", { name: "Use an example query", exact: true }),
      ).toBeVisible();
    });
    const initialSql = withBigQuery
      ? "select row_id, sentinel from sql_v2_04 order by row_id"
      : "select order_id from orders order by order_id limit 50";
    if (withBigQuery) {
      await writeSqlEditor(editor, initialSql);
      await expect
        .poll(async () => {
          const read = projectRead.parse(
            await flow.action("get-project", { projectId }),
          );
          const contents = read.project.cells[0]?.contents;
          return contents?.kind === "sql" ? contents.source : undefined;
        }, timeout)
        .toBe(initialSql);
    }
    const held = gate();
    const saves: Request[] = [];
    await flow.page.route(paths.save, async (route) => {
      saves.push(route.request());
      await held.wait;
      await settleHeldRoute(() => route.continue());
    });
    const request = await flow.transition(
      "Hold source save, then observe Saving → Queued → running",
      async () => {
        const dispatch = flow.page.waitForRequest((value) =>
          ["start-notebook-run", "run-project-cell"].includes(
            actionName(value.url()) ?? "",
          ),
        );
        void dispatch.catch(() => {});
        const run = cell.getByRole("button", { name: /^Run SQL/ });
        const pendingAdmission = gate();
        const start = "**/_agent-native/actions/start-notebook-run";
        await flow.page.route(start, async (route) => {
          await pendingAdmission.wait;
          await settleHeldRoute(() => route.continue());
        });
        try {
          if (withBigQuery) await chooseSource(flow, cell, source);
          else await writeSqlEditor(editor, initialSql);
          await expect.poll(() => saves.length).toBeGreaterThan(0);
          if (!(await run.isEnabled()))
            flow.missing("Run accepts intent while the source save is pending");
          await run.click();
          await flow.require(
            flow.page.getByText("Saving…", { exact: true }).first(),
            "Run waits for the accepted source and SQL save",
          );
          held.release();
          const admitted = await dispatch;
          if (actionName(admitted.url()) !== "start-notebook-run")
            flow.missing("start-notebook-run");
          await flow.require(
            flow.page.getByText("Saving changes…", { exact: true }),
            "Run admission in progress",
          );
          pendingAdmission.release();
          return admitted;
        } finally {
          held.release();
          pendingAdmission.release();
          await flow.page.unroute(paths.save);
          await flow.page.unroute(start);
        }
      },
    );
    const firstAttempt = await flow.readback(
      "Initial attempt and accepted source",
      async () => {
        const first = await admittedRun(flow, request, cell);
        expect(
          first.events.flatMap(({ event }) =>
            event.type === "attempt" &&
            event.receipt.attempt.cellId === first.cellId
              ? [event.receipt.state.status]
              : [],
          ),
        ).toEqual(["queued", "running", "complete"]);
        const read = projectRead.parse(
          await flow.action("get-project", { projectId }),
        );
        expect(read.project.cells).toHaveLength(1);
        expect(read.project.cells[0]).toMatchObject({
          id: first.cellId,
          contents: { source: initialSql, dataConnectionId: source.id },
        });
        return first;
      },
    );
    if (!withBigQuery)
      flow.unavailable(
        "SQL fixture rows 20,000 × 2 and wrong-source sentinel 7 require --bq-key-file",
      );
    await flow.oracle(
      "Result controls, 50-row default and zero-based indexes",
      async () => {
        await expect(output(cell).locator("tbody tr")).toHaveCount(50, timeout);
        await expect(
          output(cell).locator("tbody tr").first().locator("th"),
        ).toHaveText("0");
        for (const name of ["View", "Format", "Columns", "Totals"]) {
          await expect(
            cell.getByRole("button", { name, exact: true }),
          ).toBeVisible();
        }
      },
    );

    await flow.transition(
      "Page 5 and 400 read durable results without submitting SQL",
      async () => {
        const submissions: string[] = [];
        const record = (pending: Request) => {
          const name = actionName(pending.url());
          if (name === "start-notebook-run" || name === "run-project-cell")
            submissions.push(name);
        };
        flow.page.on("request", record);
        try {
          for (const page of [5, 400]) {
            await changePage(flow, cell, page);
            await verifyRows(cell, idsAndSentinel(page, 42));
            const stored = await readResultPage(
              flow,
              firstAttempt.resultId,
              page,
              "20000",
            );
            expect(stored.manifest.result.producer.attemptId).toBe(
              firstAttempt.attemptId,
            );
            expect(stored.manifest.result.sourceGeneration).not.toBeNull();
            expect(numericRows(stored.rows)).toEqual(idsAndSentinel(page, 42));
          }
          expect(submissions).toEqual([]);
        } finally {
          flow.page.off("request", record);
        }
      },
    );
    await flow.cold(
      "Saved page 400 survives a new browser context",
      async (page) => {
        await page.goto(flow.url(notebook(projectId)));
        await verifyRows(cells(page).first(), idsAndSentinel(400, 42));
      },
    );

    await flow.transition(
      "Rerun changes the saved sentinel from 42 to 84 without resetting page",
      async () => {
        await writeSqlEditor(
          editor,
          "select row_id, 84 as sentinel from sql_v2_04 order by row_id",
        );
        const rerun = await admittedRun(
          flow,
          await observeRun(flow, cell),
          cell,
        );
        expect(rerun.resultId).not.toBe(firstAttempt.resultId);
        expect(rerun.attemptId).not.toBe(firstAttempt.attemptId);
        expect(rerun.outputGeneration).not.toBe(firstAttempt.outputGeneration);
        await verifyRows(cell, idsAndSentinel(400, 84));
        expect(
          numericRows(
            (await readResultPage(flow, rerun.resultId, 400, "20000")).rows,
          ),
        ).toEqual(idsAndSentinel(400, 84));
      },
    );
    await flow.oracle(
      "Empty successful output shows No data and 0 rows",
      async () => {
        await writeSqlEditor(
          editor,
          "select row_id, sentinel from sql_v2_04 where false",
        );
        const empty = await admittedRun(
          flow,
          await observeRun(flow, cell),
          cell,
        );
        const stored = await readResultPage(flow, empty.resultId, 1, "0");
        expect(stored.manifest.status).toBe("complete-empty");
        expect(stored.manifest.result.producer.attemptId).toBe(empty.attemptId);
        expect(stored.rows).toEqual([]);
        await expect(cell.getByText("No data", { exact: true })).toBeVisible();
        await expect(cell.getByText("0 rows", { exact: true })).toBeVisible();
      },
    );
    await flow.rejecting(
      "Provider compiler diagnostic is persisted with exact reason and location",
      async () => {
        await writeSqlEditor(editor, "select no_such_column from sql_v2_04");
        const failed = await failedRun(
          flow,
          await observeRun(flow, cell),
          cell,
        );
        const diagnostic = z
          .object({
            status: z.literal("found"),
            traceId: id,
            diagnostic: z.object({
              code: z.literal("warehouse_query_failed"),
              message: id,
              provider: z.object({
                reason: z.literal("invalidQuery"),
                message: id,
                line: z.number(),
                column: z.number(),
              }),
            }),
          })
          .parse(await flow.action("get-notebook-run-diagnostics", failed));
        expect(diagnostic.diagnostic).toMatchObject({
          message: "Unrecognized name: no_such_column",
          provider: {
            message: "Unrecognized name: no_such_column",
            line: 1,
            column: 8,
          },
        });
        flow.id("providerTrace", diagnostic.traceId);
        await expect(
          cell.getByText("Your query could not be executed", { exact: true }),
        ).toBeVisible();
        const fix = cell.getByRole("button", {
          name: "Fix with agent",
          exact: true,
        });
        await expect(fix).toBeVisible();
        const submits: string[] = [];
        const record = (request: Request) => {
          if (
            request.method() === "POST" &&
            new URL(request.url()).pathname.endsWith(
              "/_agent-native/agent-chat",
            )
          )
            submits.push("agent-chat");
        };
        flow.page.on("request", record);
        try {
          await fix.click();
          await expect(
            flow.page
              .locator("[contenteditable='true']")
              .filter({ hasText: "no_such_column" }),
          ).toBeVisible();
          expect(submits).toEqual([]);
        } finally {
          flow.page.off("request", record);
        }
      },
    );
    const cellId = firstAttempt.cellId;
    await flow.transition(
      "Late 42 completion cannot replace the newer 84 result",
      () =>
        withHeldDraftQuery(
          flow,
          { projectId, cellId },
          "before-promotion",
          async (hold) => {
            await writeSqlEditor(
              editor,
              "select row_id, sentinel from sql_v2_04 where true order by row_id",
            );
            const response = await (await observeRun(flow, cell)).response();
            expect(response?.ok()).toBe(true);
            const late = runReceiptSchema.parse(await response?.json());
            const attemptId = await hold.waitForAttempt(late.runId);
            expect(attemptId).toBe(late.attempts[0]?.attempt.attemptId);

            const sql =
              "select row_id, 84 as sentinel from sql_v2_04 order by row_id";
            await writeSqlEditor(editor, sql);
            await expect
              .poll(async () => {
                const saved = projectRead.parse(
                  await flow.action("get-project", { projectId }),
                );
                const contents = saved.project.cells[0]?.contents;
                return contents?.kind === "sql" ? contents.source : undefined;
              }, timeout)
              .toBe(sql);
            const { snapshot } = z
              .object({ snapshot: executionSnapshotSchema })
              .parse(
                await flow.action("get-notebook-execution", { projectId }),
              );
            const intent = warehouseCellRunIntent({
              requestId: randomUUID(),
              snapshot,
              targetCellId: cellId,
              cache: "reuse",
            });
            const winner = runReceiptSchema.parse(
              await flow.action("start-notebook-run", intent),
            );
            expect(winner.plan.admittedCellIds).toEqual([cellId]);
            expect(winner.attempts[0]?.attempt.outputGeneration).not.toBe(
              late.attempts[0]?.attempt.outputGeneration,
            );
            await hold.release();
            await expect
              .poll(
                () =>
                  flow.action("get-notebook-run-diagnostics", {
                    runId: late.runId,
                    attemptId,
                  }),
                timeout,
              )
              .toMatchObject({
                status: "found",
                diagnostic: { code: "superseded" },
              });
            const { resultId } = await completedWarehouseAttempt(
              flow,
              winner.runId,
              cellId,
            );
            expect(
              numericRows(
                (await readResultPage(flow, resultId, 400, "20000")).rows,
              ),
            ).toEqual(idsAndSentinel(400, 84));
            expect(
              await flow.action("get-notebook-cell-execution", {
                projectId,
                cellId,
              }),
            ).toMatchObject({
              status: "found",
              runId: winner.runId,
              resultId,
            });
          },
        ),
    );
    await rejectRevokedSqlSource(flow);
  },
};

const regionalTotals = [
  ["North", 42],
  ["South", 84],
] satisfies [string, number][];
const storedRegionalTotals = regionalTotals.map(([region, total]) => [
  region,
  { type: "decimal" as const, value: String(total) },
]);

const dataframeStatements = [
  {
    name: "amounts",
    sql: "select 1 as id, 42 as amount union all select 2, 84",
    rows: [
      [1, 42],
      [2, 84],
    ],
  },
  {
    name: "regions",
    sql: "select 1 as id, 'North' as region union all select 2, 'South'",
    rows: [
      [1, "North"],
      [2, "South"],
    ],
  },
  {
    name: "joined",
    sql: "select r.region, a.amount from amounts a join regions r on r.id = a.id order by a.id",
    rows: regionalTotals,
  },
  {
    name: "by_region",
    sql: "select region, sum(amount) as total from joined group by region order by region",
    rows: regionalTotals,
    storedRows: storedRegionalTotals,
  },
  {
    name: "selected_regions",
    sql: "select region, total from by_region where region in ('North', 'South') order by region",
    rows: regionalTotals,
    storedRows: storedRegionalTotals,
  },
  {
    name: "grand_total",
    sql: "select sum(total)::bigint as grand_total from selected_regions",
    rows: [[126]],
  },
] satisfies Array<{
  name: string;
  sql: string;
  rows: (string | number)[][];
  storedRows?: Rows;
}>;

async function dataframeMode(flow: FlowContext, cell: Locator) {
  await sourcePicker(cell).click();
  const option = flow.page.getByRole("menuitemradio", { name: /^Dataframes/ });
  await flow.require(option, "Dataframes source");
  await expect(
    option.getByText("Query all dataframes in scope", { exact: true }),
  ).toBeVisible();
  await option.click();
  await expect(sourcePicker(cell)).toHaveAccessibleName(
    "Data connection: Dataframes",
  );
}

async function nameDataframe(
  flow: FlowContext,
  cell: Locator,
  name: string,
  defaultName?: string,
) {
  const variable = cell.locator("button.nb-result-variable-name").first();
  await flow.require(variable, "Result dataframe pill");
  if (defaultName) await expect(variable).toHaveText(defaultName);
  await variable.click();
  const rename = cell.getByRole("textbox", { name: "Result variable name" });
  await rename.fill(name);
  await rename.press("Enter");
  await expect(variable).toHaveText(name);
}

async function verifyDataframeRejections(flow: FlowContext) {
  const actor = await notebookCreateViewer(flow);
  const { user } = await flow.identity(actor);
  const { fixtureId, connectionId } = z
    .object({ fixtureId: z.uuid(), connectionId: id })
    .parse(
      await controlWarehouseEntitlement(flow, {
        operation: "warehouse-create-entitlement",
        colleagueEmail: user.email,
      }),
    );
  const projectId = await createWarehouseEntitlementProject(
    flow,
    flow.name("Dataframe producer boundaries"),
    [
      {
        source: "select 42 as n",
        dataConnectionId: connectionId,
        resultVariable: "protected_values",
      },
      {
        source: "select n from protected_values",
        dataConnectionId: null,
        resultVariable: "read_protected",
      },
      {
        source: "select 84 as n",
        dataConnectionId: connectionId,
        resultVariable: "partial_values",
      },
      {
        source: "select n from partial_values",
        dataConnectionId: null,
        resultVariable: "read_partial",
      },
    ],
  );
  flow.id("dataframeRejectionsProject", projectId);
  const { project } = projectRead.parse(
    await flow.action("get-project", { projectId }),
  );
  const [
    protectedProducer,
    protectedConsumer,
    partialProducer,
    partialConsumer,
  ] = z.tuple([id, id, id, id]).parse(project.cells.map((cell) => cell.id));
  await flow.action("share-resource", {
    resourceType: "analytics-project",
    resourceId: projectId,
    principalType: "user",
    principalId: user.email,
    role: "editor",
    notify: false,
  });

  await flow.withActor(actor, async (page) => {
    await page.goto(flow.url(notebook(projectId)));
    const snapshot = { kind: "draft", projectId } as const;
    const noKernel = async () =>
      expect(
        await flow.action(
          "get-notebook-kernel-session",
          { scope: snapshot },
          actor,
        ),
      ).toEqual({
        status: "found",
        generation: "0",
        state: "absent",
        variables: [],
      });

    const runCellOnly = async (cellId: string) => {
      const options = page
        .locator(`[data-notebook-cell="${cellId}"]`)
        .getByRole("button", { name: "Run mode", exact: true });
      await options.click();
      const [response] = await Promise.all([
        page.waitForResponse(
          (value) =>
            actionName(value.url()) === "start-notebook-run" &&
            value.request().method() === "POST",
        ),
        page.getByRole("menuitem", { name: "Cell only", exact: true }).click(),
      ]);
      expect(response.ok()).toBe(true);
      const receipt = runReceiptSchema.parse(await response.json());
      expect(receipt.request).toMatchObject({
        mode: "cell-only",
        targetCellId: cellId,
      });
      return receipt;
    };
    const readRun = (runId: string) =>
      flow.action("get-notebook-run", { runId }, actor);
    const waitForAttempt = async (
      runId: string,
      cellId: string,
      status: "complete" | "failed",
    ) => {
      const read = async () => readAttempt(await readRun(runId), runId, cellId);
      await expect
        .poll(async () => (await read()).state.status, timeout)
        .toBe(status);
      return read();
    };
    const runProducer = async (cellId: string) => {
      const run = await runCellOnly(cellId);
      expect(run.plan.admittedCellIds).toEqual([cellId]);
      const { state } = await waitForAttempt(run.runId, cellId, "complete");
      if (state.status !== "complete")
        throw new Error("The dataframe producer did not finish");
      expect(state.resultIds).toHaveLength(1);
      return id.parse(state.resultIds[0]);
    };
    const resultPage = (resultId: string) =>
      flow.action("get-notebook-result-page", { resultId, page: 1 }, actor);

    await flow.rejecting(
      "Revoking producer access denies the consumer before a kernel starts",
      async () => {
        const resultId = await runProducer(protectedProducer);
        const { rows } = readCompletedResultPage(
          await resultPage(resultId),
          1,
          "1",
          resultId,
        );
        expect(numericRows(rows)).toEqual([[42]]);
        await noKernel();
        try {
          expect(
            await controlWarehouseEntitlement(flow, {
              operation: "warehouse-revoke-entitlement",
              fixtureId,
            }),
          ).toEqual({ fixtureId, entitled: false });
          expect(await resultPage(resultId)).toEqual({
            status: "denied",
            reason: "access_denied",
          });
          const run = await runCellOnly(protectedConsumer);
          expect(run.plan.admittedCellIds).toEqual([protectedConsumer]);
          expect(run.plan.dependencyResultIds).toEqual([resultId]);
          const { attempt } = await waitForAttempt(
            run.runId,
            protectedConsumer,
            "failed",
          );
          expect(
            await flow.action(
              "get-notebook-run-diagnostics",
              { runId: run.runId, attemptId: attempt.attemptId },
              actor,
            ),
          ).toMatchObject({
            status: "found",
            diagnostic: { code: "dataframe_denied" },
            compiledSql: null,
          });
          expect(
            await flow.action(
              "get-notebook-cell-execution",
              { projectId, cellId: protectedConsumer },
              actor,
            ),
          ).toMatchObject({ status: "found", resultId: null, outputs: [] });
          await noKernel();
        } finally {
          expect(
            await controlWarehouseEntitlement(flow, {
              operation: "warehouse-restore-entitlement",
              fixtureId,
            }),
          ).toEqual({ fixtureId, entitled: true });
        }
      },
    );

    await flow.rejecting(
      "An incomplete producer is excluded from admission without starting a kernel",
      async () => {
        const scope = { projectId, cellId: partialProducer };
        expect(
          await flow.workerFixture("draft-incomplete-result", scope),
        ).toEqual({ armed: true });
        try {
          const resultId = await runProducer(partialProducer);
          expect(await resultPage(resultId)).toEqual({
            status: "incomplete",
            resultId,
            page: 1,
            reason: "truncated",
            knownRows: "1",
          });
          const run = await runCellOnly(partialConsumer);
          const durable = readRunAttempts(await readRun(run.runId), run.runId);
          const expected = {
            admittedCellIds: [],
            dependencyResultIds: [],
            rejectedCells: [
              { cellId: partialConsumer, reason: "missing_prerequisite" },
            ],
          };
          for (const receipt of [run, durable]) {
            expect(receipt.plan).toEqual(expected);
            expect(receipt.attempts).toEqual([]);
          }
          expect(
            await flow.action(
              "get-notebook-cell-execution",
              {
                projectId,
                cellId: partialConsumer,
              },
              actor,
            ),
          ).toEqual({ status: "absent", reason: "not_found" });
          await noKernel();
        } finally {
          expect(await flow.workerFixture("draft-reset-result", scope)).toEqual(
            { reset: true },
          );
        }
      },
    );
  });
}

const dataframeChain: FlowDefinition = {
  id: "05-dataframe-chain",
  async run(flow) {
    const source = flow.bqKeyFile ? await fixtureWarehouse(flow) : demo;
    const projectId = await seedNotebook(flow, "Dataframe chain evidence");
    await flow.open(notebook(projectId));
    const receipts: Awaited<ReturnType<typeof admittedRun>>[] = [];
    const sourceGenerations: (string | null)[] = [];
    const sessionSchema = z.object({
      status: z.literal("found"),
      generation: id,
      state: z.enum([
        "absent",
        "queued",
        "starting",
        "idle",
        "busy",
        "stopped",
        "expired",
      ]),
      variables: z.array(kernelVariableSchema),
    });
    const kernel = () =>
      flow
        .action("get-notebook-kernel-session", {
          scope: { kind: "draft", projectId },
        })
        .then((value) => sessionSchema.parse(value));
    for (const [index, statement] of dataframeStatements.entries()) {
      await flow.transition(`Run and name ${statement.name}`, async () => {
        const cell = await addSql(flow);
        if (index < 2) await selectSource(flow, cell, source);
        else {
          if (index > 2)
            await expect(sourcePicker(cell)).toHaveAccessibleName(
              "Data connection: Dataframes",
            );
          await flow.oracle(
            "Dataframes source, scope hint and remembered selection",
            () => dataframeMode(flow, cell),
          );
        }
        await writeSqlEditor(sqlEditor(cell), statement.sql);
        const result = await admittedRun(
          flow,
          await observeRun(flow, cell),
          cell,
        );
        await verifyRows(cell, statement.rows);
        await nameDataframe(
          flow,
          cell,
          statement.name,
          index === 0 ? "dataframe" : undefined,
        );
        receipts.push(result);
      });

      await flow.readback(
        `Stored ${statement.name} and its exact rows and provenance`,
        async () => {
          const attempt = receipts[index];
          if (!attempt) throw new Error("Dataframe attempt is absent");
          await expect
            .poll(async () => {
              const saved = projectRead.parse(
                await flow.action("get-project", { projectId }),
              );
              return saved.project.cells[index];
            }, timeout)
            .toMatchObject({
              id: attempt.cellId,
              contents: {
                source: statement.sql,
                dataConnectionId: index < 2 ? source.id : null,
                resultVariable: statement.name,
                ...(index >= 2 ? { connectionMode: "dataframes" } : {}),
              },
            });
          const page = await readResultPage(
            flow,
            attempt.resultId,
            1,
            String(statement.rows.length),
          );
          if (statement.storedRows)
            expect(page.rows).toEqual(statement.storedRows);
          else expect(numericRows(page.rows)).toEqual(statement.rows);
          const provenance = page.manifest.result;
          expect(provenance.producer.attemptId).toBe(attempt.attemptId);
          expect(provenance.snapshot).toEqual(attempt.run.request.snapshot.ref);
          if (index < 2) {
            expect(provenance.kernelGeneration).toBeNull();
            expect(provenance.dependencyFingerprint).toBe(
              dependencyFingerprint([]),
            );
            if (flow.bqKeyFile)
              expect(provenance.sourceGeneration).not.toBeNull();
            sourceGenerations.push(provenance.sourceGeneration);
            if (index === 1)
              expect(sourceGenerations[1]).toBe(sourceGenerations[0]);
          } else {
            const upstream =
              index === 2
                ? receipts.slice(0, 2)
                : receipts.slice(index - 1, index);
            const upstreamIds = upstream.map((item) => item.resultId);
            expect(attempt.run.plan.dependencyResultIds).toEqual(upstreamIds);
            expect(provenance.dependencyFingerprint).toBe(
              dependencyFingerprint(upstreamIds),
            );
            const current = await kernel();
            expect(current.state).toBe("idle");
            expect(provenance.kernelGeneration).toBe(current.generation);
            expect(provenance.sourceGeneration).toBeNull();
            const storedExecution = z
              .object({
                status: z.literal("found"),
                runId: id,
                attemptId: id,
                resultId: id,
                kernelGeneration: id,
              })
              .parse(
                await flow.action("get-notebook-cell-execution", {
                  projectId,
                  cellId: attempt.cellId,
                }),
              );
            expect(storedExecution).toMatchObject({
              runId: attempt.runId,
              attemptId: attempt.attemptId,
              resultId: attempt.resultId,
              kernelGeneration: current.generation,
            });
            if (index === 5)
              expect(page.manifest.fields).toMatchObject([
                { name: "grand_total", type: "integer" },
              ]);
          }
        },
      );
    }
    await attestKernel(flow);
    const before = await kernel();
    flow.id("kernelGeneration", before.generation);
    await flow.cold(
      "Reopen every producer, symbol and result with the same generation",
      async (page) => {
        await page.goto(flow.url(notebook(projectId)));
        for (const [index, statement] of dataframeStatements.entries()) {
          const cell = cells(page).nth(index);
          await expect(
            cell.getByRole("button", { name: statement.name, exact: true }),
          ).toBeVisible(timeout);
          await verifyRows(cell, statement.rows);
        }
        expect((await kernel()).generation).toBe(before.generation);
      },
    );
    await flow.transition(
      "A row beyond the first page contributes to the dataframe aggregate",
      async () => {
        if (!flow.bqKeyFile)
          flow.unavailable(
            "The 75-row warehouse fixture requires --bq-key-file",
          );
        const producer = await addSql(flow);
        await selectSource(flow, producer, source);
        await writeSqlEditor(
          sqlEditor(producer),
          "select id, if(id = 75, 126, 0) as amount from unnest(generate_array(1, 75)) as id order by id",
        );
        const wide = await admittedRun(
          flow,
          await observeRun(flow, producer),
          producer,
        );
        await expect(output(producer).locator("tbody tr")).toHaveCount(
          50,
          timeout,
        );
        const beyondPreview = await readResultPage(
          flow,
          wide.resultId,
          2,
          "75",
        );
        expect(numericRows(beyondPreview.rows)).toEqual(
          Array.from({ length: 25 }, (_, index) => [
            index + 51,
            index === 24 ? 126 : 0,
          ]),
        );
        await nameDataframe(flow, producer, "all_75_rows");
        const consumer = await addSql(flow);
        await dataframeMode(flow, consumer);
        await writeSqlEditor(
          sqlEditor(consumer),
          "select sum(amount) as total from all_75_rows",
        );
        const total = await admittedRun(
          flow,
          await observeRun(flow, consumer),
          consumer,
        );
        await verifyRows(consumer, [[126]]);
        const aggregate = await readResultPage(flow, total.resultId, 1, "1");
        expect(aggregate.rows).toEqual([[{ type: "decimal", value: "126" }]]);
        expect(total.run.plan.dependencyResultIds).toEqual([wide.resultId]);
        expect(aggregate.manifest.result.dependencyFingerprint).toBe(
          dependencyFingerprint([wide.resultId]),
        );
      },
    );
    await flow.readback(
      "Arrow result preserves a typed NULL and exact decimal scale",
      async () => {
        const cell = await addSql(flow);
        await expect(sourcePicker(cell)).toHaveAccessibleName(
          "Data connection: Dataframes",
        );
        await writeSqlEditor(
          sqlEditor(cell),
          "select cast(null as decimal(10, 2)) as missing, cast('42.50' as decimal(10, 2)) as amount",
        );
        const result = await admittedRun(
          flow,
          await observeRun(flow, cell),
          cell,
        );
        const stored = await readResultPage(flow, result.resultId, 1, "1");
        expect(stored.manifest.fields).toMatchObject([
          { name: "missing", type: "decimal" },
          { name: "amount", type: "decimal" },
        ]);
        expect(stored.rows).toEqual([
          [null, { type: "decimal", value: "42.50" }],
        ]);
        await verifyRows(cell, [["null", "42.50"]]);
      },
    );
    await flow.rejecting(
      "Missing Dataframes relation is rejected and DuckDB reports invalid columns on an admitted query",
      async () => {
        const cell = await addSql(flow);
        await expect(sourcePicker(cell)).toHaveAccessibleName(
          "Data connection: Dataframes",
        );
        const editor = sqlEditor(cell);
        await writeSqlEditor(editor, "select * from missing_phase1_dataframe");
        const admission = await (await observeRun(flow, cell)).response();
        if (!admission?.ok())
          throw new Error("Missing relation admission is unreadable");
        const initial = runReceiptSchema.parse(await admission.json());
        const cellId = id.parse(await cell.getAttribute("data-notebook-cell"));
        expect(initial.plan.rejectedCells).toEqual([
          { cellId, reason: "missing_prerequisite" },
        ]);
        expect(initial.attempts).toEqual([]);
        const stored = z
          .object({ status: z.literal("found"), run: runReceiptSchema })
          .parse(
            await flow.action("get-notebook-run", { runId: initial.runId }),
          );
        expect(stored.run.plan.rejectedCells).toEqual(
          initial.plan.rejectedCells,
        );
        expect(stored.run.attempts).toEqual([]);

        await writeSqlEditor(
          editor,
          "select missing_phase1_column from selected_regions",
        );
        const failed = await failedRun(
          flow,
          await observeRun(flow, cell),
          cell,
        );
        const diagnostic = z
          .object({
            status: z.literal("found"),
            diagnostic: z.object({ message: id }),
            compiledSql: id,
          })
          .parse(await flow.action("get-notebook-run-diagnostics", failed));
        expect(diagnostic.compiledSql).toContain("missing_phase1_column");
        expect(diagnostic.diagnostic.message).toMatch(
          /Referenced column "missing_phase1_column" not found/,
        );
      },
    );
    await verifyDataframeRejections(flow);
  },
};

export const flows01To05 = [
  connectWarehouse,
  catalogTableToQuery,
  createNotebook,
  writeRunSql,
  dataframeChain,
];
