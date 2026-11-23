import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { closeDbExec } from "@agent-native/core/db";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getNotebookExecution: vi.fn(),
  loadNotebookResult: vi.fn(),
  getNotebookResultPage: vi.fn(),
  assertDataframeConnectionAccess: vi.fn(),
}));

vi.mock("./notebook-execution/draft-state.js", () => ({
  getNotebookExecution: mocks.getNotebookExecution,
}));

vi.mock("./notebook-results.js", () => ({
  loadNotebookResult: mocks.loadNotebookResult,
  getNotebookResultPage: mocks.getNotebookResultPage,
}));

vi.mock("./data-connections.js", () => ({
  assertDataframeConnectionAccess: mocks.assertDataframeConnectionAccess,
}));

import { getDb, schema } from "../db/index.js";
import { runAnalytics2Migrations } from "../plugins/db.js";
import { createComponent, readComponent } from "./components-store.js";
import { ensureAnalyticsDatabase } from "./database.js";

let tempDir: string | undefined;
const scope = { ownerEmail: "qa@example.test", orgId: "org-components" };

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "analytics-components-"));
  vi.stubEnv("DATABASE_URL", `pglite:${path.join(tempDir, "db")}`);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  await closeDbExec();
  await runAnalytics2Migrations(undefined);
  await ensureAnalyticsDatabase();
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  mocks.getNotebookExecution.mockReset();
  mocks.loadNotebookResult.mockReset();
  mocks.getNotebookResultPage.mockReset();
  mocks.assertDataframeConnectionAccess.mockReset();
  mocks.assertDataframeConnectionAccess.mockResolvedValue(undefined);
});

it("report QA-1795079397 captures durable notebook execution outputs and preserves cell order", async () => {
  const now = new Date().toISOString();
  const projectId = "prj_durable_comp";
  const versionId = "ver_durable_comp";
  await getDb().insert(schema.projects).values({
    id: projectId,
    ownerEmail: scope.ownerEmail,
    orgId: scope.orgId,
    visibility: "private",
    title: "Durable Component Source",
    workingVersionId: versionId,
    createdAt: now,
    updatedAt: now,
  });

  await getDb()
    .insert(schema.cells)
    .values([
      {
        id: "cel_chart",
        projectId,
        versionId,
        kind: "chart",
        label: "Revenue by region",
        order: "a2",
        contents: JSON.stringify({
          id: "cel_chart",
          kind: "chart",
          order: "a2",
          label: "Revenue by region",
          hidden: false,
          gridX: null,
          gridY: null,
          gridWidth: null,
          gridHeight: null,
          dataframe: "rev_by_region",
          chartSpec: {
            version: 2,
            mark: "bar",
            xField: "region",
            yField: "revenue",
            seriesField: null,
            title: null,
            sourceCellId: "cel_sql",
          },
        }),
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "cel_sql",
        projectId,
        versionId,
        kind: "sql",
        label: "Revenue SQL",
        order: "a1",
        contents: JSON.stringify({
          id: "cel_sql",
          kind: "sql",
          order: "a1",
          label: "Revenue SQL",
          hidden: false,
          gridX: null,
          gridY: null,
          gridWidth: null,
          gridHeight: null,
          source: "SELECT region, revenue FROM orders",
          resultVariable: "rev_by_region",
          dataConnectionId: "builtin-sample-data",
          databaseSchema: null,
          outputResult: true,
        }),
        createdAt: now,
        updatedAt: now,
      },
    ]);

  const resultId = "res_durable_1";
  const manifest = {
    status: "complete",
    result: {
      resultId,
      producer: {
        namespaceId: "ns_1",
        cellId: "cel_sql",
        runId: "run_1",
        attemptId: "att_1",
        outputGeneration: 1,
      },
      provenance: "warehouse",
      sourceGeneration: "gen_1",
      kernelGeneration: null,
    },
    fields: [
      { fieldId: "f1", name: "region", type: "string", nullable: false },
      { fieldId: "f2", name: "revenue", type: "decimal", nullable: false },
    ],
    rowCount: "2",
  };

  mocks.getNotebookExecution.mockResolvedValue({
    status: "found",
    cells: {
      cel_sql: {
        stale: false,
        resultId,
        attempt: null,
        finishedAt: now,
      },
    },
  });
  mocks.loadNotebookResult.mockResolvedValue({
    status: "found",
    row: {
      authorities: [{ connectionId: "conn_wh_1", generation: "gen_1" }],
    },
    manifest,
    viewKey: "vk_1",
    pythonDisplay: false,
    pythonPrimary: false,
  });
  mocks.getNotebookResultPage.mockResolvedValue({
    status: "ready",
    manifest,
    page: 1,
    rows: [
      ["EMEA", { type: "decimal", value: "1250" }],
      ["APAC", { type: "decimal", value: "980" }],
    ],
    view: { page: 1, viewRevision: "0" },
  });

  const component = await createComponent(scope, {
    projectId,
    name: "Regional Revenue",
    cellIds: ["cel_chart", "cel_sql"],
    caller: "qa@example.test",
  });

  const stored = await readComponent(scope, component.id, "qa@example.test");
  expect(stored).not.toBeNull();
  expect(stored?.cells.map((cell) => cell.id)).toEqual([
    "cel_sql",
    "cel_chart",
  ]);
  expect(stored?.cells[0]?.output).toEqual({
    type: "table",
    columns: [
      { name: "region", type: "string" },
      { name: "revenue", type: "number" },
    ],
    rows: [
      ["EMEA", 1250],
      ["APAC", 980],
    ],
    rowCount: 2,
    truncated: false,
    totalRows: "2",
  });
  expect(mocks.assertDataframeConnectionAccess).toHaveBeenCalledWith(
    "conn_wh_1",
    "qa@example.test",
  );
});
