import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  orgMembers,
  organizations,
  ORG_MIGRATIONS,
} from "@agent-native/core/org";
import {
  listPrivateBlobProviders,
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import {
  loadActionsFromStaticRegistry,
  resetAppConfigForTests,
  runWithRequestContext,
} from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { z } from "zod";

import getTransform from "../../actions/get-notebook-transform.js";
import getPage from "../../actions/get-notebook-visualization-page.js";
import openDrill from "../../actions/open-notebook-visualization-drill.js";
import { cellContentsSchema } from "../../app/lib/model/contracts.js";
import {
  pivotMatrixRows,
  readVisualizationTransform,
} from "../../e2e/phase1/visualization-readback.js";
import {
  appSessionIdSchema,
  releaseIdSchema,
  runIdSchema,
  runRequestSchema,
} from "../../shared/notebook-execution.js";
import {
  authorizedResultRefSchema,
  resultManifestSchema,
} from "../../shared/notebook-result-contract.js";
import { defaultPivotConfig } from "../../shared/pivot-config.js";
import { SAMPLE_DATA_SOURCE_ID } from "../../shared/sample-data-contract.js";
import { defaultTableConfig } from "../../shared/table-visualization-config.js";
import {
  notebookTransformSchema,
  visualizationDrillOutputSchema,
  visualizationPageOutputSchema,
  type VisualizationDrillInput,
} from "../../shared/visualization-contracts.js";
import { getDb, schema } from "../db/index.js";
import {
  analyticsMigrations,
  runAnalyticsMigrations,
} from "../db/migrations.js";
import { localNotebookBlobProvider } from "../execution/local-notebook-blob.js";
import {
  notebookResultFields,
  RESULT_SEGMENT_ROWS,
  stageNotebookSegment,
} from "../execution/notebook-arrow.js";
import { digest } from "./notebook-execution/planner.js";
import { createRunStore } from "./notebook-execution/run-store.js";
import {
  notebookOutputs,
  notebookResultManifests,
} from "./notebook-execution/schema.js";
import { notebookRunStore } from "./notebook-execution/service.js";
import {
  draftNamespace,
  readCurrentDraftSnapshot,
  readDraftSnapshot,
} from "./notebook-execution/snapshot.js";
import { publishCheckedPreview } from "./project-releases.js";
import { createPublishPreview, getPublishPreview } from "./publish-previews.js";
import {
  openPublishedAppSession,
  refreshPublishedAppResults,
} from "./published-app-sessions.js";

vi.mock("../execution/visualization-kernel.js", async (original) => ({
  ...(await original<typeof import("../execution/visualization-kernel.js")>()),
  executeVisualizationSql: (
    await import("../testing/visualization-sql-fixture.js")
  ).runVisualizationInPGlite,
}));
vi.mock("../execution/warehouse-connector.js", async (original) => ({
  ...(await original<typeof import("../execution/warehouse-connector.js")>()),
  withWarehouseSource: async (
    _id: string,
    _actor: unknown,
    callback: (source: { generation: string }) => Promise<unknown>,
  ) => callback({ generation: authority.generation }),
}));
vi.mock("./notebook-execution/service.js", async (original) => ({
  ...(await original<typeof import("./notebook-execution/service.js")>()),
  wakeNotebookRun: vi.fn(),
}));
const authority = vi.hoisted(() => ({ generation: "1" }));

const actor = {
  orgId: "visualization-fixture",
  ownerEmail: "owner@fixture.test",
  caller: "frontend",
};
const recipient = { ...actor, ownerEmail: "recipient@fixture.test" };
const other = { ...actor, orgId: "visualization-other" };
const context = { caller: "frontend" as const };
const now = new Date(0).toISOString();
const store = createRunStore(readDraftSnapshot);
const actions = loadActionsFromStaticRegistry({
  "get-notebook-transform": getTransform,
  "get-notebook-visualization-page": getPage,
  "open-notebook-visualization-drill": openDrill,
});
const asActor = <T>(run: () => T, identity = actor) =>
  runWithRequestContext(
    {
      orgId: identity.orgId,
      userEmail: identity.ownerEmail,
      authUserId: identity.ownerEmail,
    },
    run,
  );
const blobs = new Map<string, Uint8Array>();
const readBlob = vi.fn(async (handle: PrivateBlobHandle) => {
  const data = blobs.get(handle.id);
  if (!data) throw new Error("Fixture blob unavailable");
  return { data, handle };
});

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  resetAppConfigForTests();
  await runMigrations(
    ORG_MIGRATIONS.map(({ name, ...entry }) =>
      name ? { name, ...entry } : entry,
    ),
    { table: "visualization_org_migrations" },
  )(undefined);
  await runMigrations(
    analyticsMigrations.filter(({ version }) => version <= 25),
    {
      table: "analytics2_migrations",
    },
  )(undefined);
  await runAnalyticsMigrations(undefined);
  await getDb()
    .insert(organizations)
    .values(
      [actor, other].map((scope) => ({
        id: scope.orgId,
        name: scope.orgId,
        createdAt: 0,
        createdBy: scope.ownerEmail,
      })),
    );
  await getDb()
    .insert(orgMembers)
    .values(
      [actor, recipient, other].map((scope) => ({
        id: randomUUID(),
        orgId: scope.orgId,
        email: scope.ownerEmail,
        joinedAt: 0,
        role: "owner" as const,
      })),
    );
  registerPrivateBlobProvider({
    id: "visualization-test",
    name: "Visualization fixture",
    isConfigured: () => true,
    async put({ key, data }) {
      assert(key);
      blobs.set(key, Uint8Array.from(data));
      return {
        id: key,
        provider: "visualization-test",
        encrypted: false,
        opaque: true,
      };
    },
    read: readBlob,
    async delete(handle) {
      return {
        deleted: blobs.delete(handle.id),
        provider: "visualization-test",
      };
    },
  });
});
afterAll(async () => {
  unregisterPrivateBlobProvider("visualization-test");
  await closeDbExec();
  vi.unstubAllEnvs();
});

const base = {
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
};
type Draft = Record<string, unknown>;
const column = (name: string, type: string) => ({ name, type });
type Columns = ReturnType<typeof column>[];
type Rows = unknown[][];

async function fixture(visualization: Draft) {
  const projectId = randomUUID();
  const versionId = randomUUID();
  const producer = randomUUID();
  const consumer = randomUUID();
  const binding = { cellId: producer, exportId: "result" };
  const namespace = draftNamespace(actor, projectId);
  await getDb().insert(schema.projects).values({
    id: projectId,
    workingVersionId: versionId,
    orgId: actor.orgId,
    ownerEmail: actor.ownerEmail,
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(schema.projectVersions).values({
    id: versionId,
    projectId,
    number: "1",
    createdAt: now,
    createdBy: actor.ownerEmail,
  });
  async function save(id: string, order: string, draft: Draft) {
    const contents = cellContentsSchema.parse({ ...base, ...draft, id, order });
    const row = {
      id,
      projectId,
      versionId,
      order,
      kind: contents.kind,
      contents: JSON.stringify(contents),
      createdAt: now,
      updatedAt: now,
    };
    await getDb()
      .insert(schema.cells)
      .values(row)
      .onConflictDoUpdate({
        target: [schema.cells.versionId, schema.cells.id],
        set: { contents: row.contents },
      });
  }
  const source = {
    kind: "sql",
    source: "SELECT 1",
    dataConnectionId: SAMPLE_DATA_SOURCE_ID,
    databaseSchema: null,
    resultVariable: "dataframe",
    outputResult: true,
  };
  await save(producer, "i", source);
  await save(consumer, "v", visualization);

  async function admitDraftRun() {
    const loaded = await readCurrentDraftSnapshot(actor, projectId);
    assert(loaded.status === "accepted");
    const admitted = await store.admit(
      actor,
      runRequestSchema.parse({
        requestId: randomUUID(),
        snapshot: loaded.value.snapshot,
        mode: "cell-only",
        targetCellId: producer,
        staleValues: "reject",
        cache: "bypass",
      }),
    );
    assert(admitted.status === "admitted");
    return admitted.runId;
  }

  async function stage(
    columns: Columns,
    rows: Rows,
    incomplete?: "sampled" | "truncated",
    authorityGeneration?: string,
    execution?: { identity: typeof actor; runId: string },
  ) {
    const [resultStore, identity, runId] = execution
      ? [
          notebookRunStore,
          execution.identity,
          runIdSchema.parse(execution.runId),
        ]
      : [store, actor, await admitDraftRun()];
    const claim = await resultStore.claim(identity, runId);
    assert(claim);
    const { snapshot } = claim.run.receipt.request;
    const artifactId = randomUUID();
    const expected = authorizedResultRefSchema.parse({
      resultId: digest(claim.attempt),
      producer: { ...claim.attempt, exportId: "result" },
      snapshot: snapshot.ref,
      inputRevision: snapshot.inputRevision,
      dependencyFingerprint: digest(
        claim.dependencies.map(({ result }) => result.resultId),
      ),
      sourceGeneration: null,
      kernelGeneration: null,
    });
    const reservation = await resultStore.renew(claim, undefined, {
      fingerprint: digest(columns),
      build: { result: expected, artifactId, authorities: [] },
    });
    assert.equal(reservation.status, "continue");
    const fields = notebookResultFields(columns);
    for (
      let startRow = 0;
      startRow < rows.length;
      startRow += RESULT_SEGMENT_ROWS
    ) {
      await stageNotebookSegment(
        {
          artifactId,
          attemptId: claim.attempt.attemptId,
          submissionId: claim.work.submissionId,
          ownerEmail: identity.ownerEmail,
          startRow,
          page: {
            columns,
            rows: rows.slice(startRow, startRow + RESULT_SEGMENT_ROWS),
          },
          fields,
        },
        (segment) => resultStore.recordSegment(claim, segment),
      );
    }
    const manifest = resultManifestSchema.parse({
      result: expected,
      fields,
      ...(incomplete
        ? {
            status: "incomplete",
            reason: incomplete,
            verifiedRowCount: String(rows.length),
          }
        : {
            status: rows.length ? "complete" : "complete-empty",
            rowCount: String(rows.length),
          }),
    });
    assert(
      await resultStore.finish(claim, {
        status: "result",
        expected,
        artifact: {
          manifest,
          artifactId,
          artifacts: [],
          authorities: [],
        },
      }),
    );
    if (authorityGeneration) {
      await getDb()
        .update(notebookResultManifests)
        .set({
          authorities: [
            { connectionId: "fixture-grant", generation: authorityGeneration },
          ],
        })
        .where(eq(notebookResultManifests.id, expected.resultId));
    }
    return expected.resultId;
  }

  const target = { projectId, cellId: consumer };
  async function transform(
    releaseId?: string,
    identity = actor,
    scope?: { sessionId: string } | { previewId: string },
  ) {
    const action = actions["get-notebook-transform"];
    assert(action);
    return notebookTransformSchema.parse(
      await asActor(
        () =>
          action.run(
            { ...target, ...(releaseId ? { releaseId } : {}), ...scope },
            context,
          ),
        identity,
      ),
    );
  }
  async function page(page: number, resultId?: string) {
    const action = actions["get-notebook-visualization-page"];
    assert(action);
    return visualizationPageOutputSchema.parse(
      await asActor(() =>
        action.run(
          { ...target, kind: "table", page, ...(resultId ? { resultId } : {}) },
          context,
        ),
      ),
    );
  }
  async function drill(input: VisualizationDrillInput, identity = actor) {
    const action = actions["open-notebook-visualization-drill"];
    assert(action);
    return visualizationDrillOutputSchema.parse(
      await asActor(() => action.run(input, context), identity),
    );
  }
  return {
    target,
    binding,
    stage,
    transform,
    phase1Transform(mode: "chart" | "pivot") {
      return readVisualizationTransform(
        {
          action: async <T>(name: string, input: object = {}): Promise<T> => {
            const action = actions[name];
            assert(action && name === "get-notebook-transform");
            const schema = action.schema;
            assert(schema instanceof z.ZodType);
            const request = schema.parse(input);
            return z
              .custom<T>()
              .parse(await asActor(() => action.run(request, context)));
          },
        },
        projectId,
        consumer,
        mode,
      );
    },
    page,
    drill,
    rename: (name: string) =>
      save(producer, "i", { ...source, resultVariable: name }),
    removePointer: () =>
      getDb()
        .delete(notebookOutputs)
        .where(eq(notebookOutputs.namespaceId, namespace.namespaceId)),
    save: (draft: Draft) => save(consumer, "v", draft),
    async createPreview() {
      const loaded = await readCurrentDraftSnapshot(actor, projectId);
      assert(loaded.status === "accepted");
      return createPublishPreview(actor, {
        projectId,
        expectedHead: loaded.value.snapshot.ref.head,
        expectedReleaseId: null,
        requestId: randomUUID(),
      });
    },
    async fieldIds() {
      const source = (await transform()).sources[0];
      assert(source);
      return Object.fromEntries(
        source.fields.map(({ name, fieldId }) => [name, fieldId]),
      );
    },
  };
}

const blankChart = {
  kind: "chart",
  dataframe: null,
  chartSpec: {
    version: 3,
    mark: "bar",
    xField: null,
    yField: null,
    seriesField: null,
    title: null,
  },
};
const chartColumns = [
  column("Group", "STRING"),
  column("Amount", "FLOAT64"),
  column("Segment", "STRING"),
];

it("renders and rereads refreshed chart results using only private local storage", async () => {
  const fixtureProvider = listPrivateBlobProviders().find(
    ({ id }) => id === "visualization-test",
  );
  assert(fixtureProvider);
  const directory = await mkdtemp(join(tmpdir(), "local-visualization-"));
  const nodeEnvironment = process.env.NODE_ENV;
  const deploymentEnvironment = process.env.AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT;
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(directory);
  const localProvider = localNotebookBlobProvider();
  cwd.mockRestore();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "local");
  unregisterPrivateBlobProvider(fixtureProvider.id);
  registerPrivateBlobProvider(localProvider);
  try {
    const doc = await fixture(blankChart);
    const columns = [column("total", "INT64")];
    const north = await doc.stage(columns, [[62]]);
    const { total } = await doc.fieldIds();
    assert(total);
    await doc.save({
      ...blankChart,
      chartSpec: {
        ...blankChart.chartSpec,
        sourceCellId: doc.binding.cellId,
        sourceExportId: "result",
        xField: total,
        yField: total,
        yAggregation: "sum",
      },
    });
    expect((await doc.transform()).result).toMatchObject({
      status: "ready",
      source: { result: { resultId: north } },
      rows: [{ x: "62", value: 62 }],
    });
    const south = await doc.stage(columns, [[84]]);
    expect(south).not.toBe(north);
    const refreshed = (await doc.transform()).result;
    expect(refreshed).toMatchObject({
      status: "ready",
      source: { result: { resultId: south } },
      rows: [{ x: "84", value: 84 }],
    });
    expect((await doc.transform()).result).toEqual(refreshed);
  } finally {
    unregisterPrivateBlobProvider(localProvider.id);
    registerPrivateBlobProvider(fixtureProvider);
    vi.stubEnv("NODE_ENV", nodeEnvironment);
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", deploymentEnvironment);
    await rm(directory, { recursive: true, force: true });
  }
});

it("aggregates late rows, filters before the 10,001-group probe and keeps category colors across a rename and rerun", async () => {
  const doc = await fixture(blankChart);
  const rows = Array.from({ length: 10_001 }, (_, i) => [
    String(i).padStart(5, "0"),
    1,
    "web",
  ]);
  await doc.stage(chartColumns, [
    ...rows,
    ["00000", 90, "web"],
    ["00000", 31, "sales"],
  ]);
  const { Group, Amount, Segment } = await doc.fieldIds();
  assert(Group && Amount && Segment);
  const spec = {
    ...blankChart.chartSpec,
    sourceCellId: doc.binding.cellId,
    sourceExportId: "result",
    xField: Group,
    yField: Amount,
    seriesField: Segment,
    yAggregation: "sum",
  };
  await doc.save({ ...blankChart, chartSpec: spec });
  const full = await doc.phase1Transform("chart");
  assert("kind" in full && full.kind === "chart");
  expect(full.rows).toHaveLength(10_000);
  expect(full.capped).toBe(true);
  expect(
    full.rows.slice(0, 2).map(({ series, value }) => [series, value]),
  ).toEqual([
    ["sales", 31],
    ["web", 91],
  ]);
  expect(full.categories).toEqual(["sales", "web"]);

  await doc.rename("renamed_source");
  await doc.stage(chartColumns, rows);
  await doc.save({
    ...blankChart,
    chartSpec: {
      ...spec,
      filters: [{ fieldId: Group, op: "eq", value: "10000" }],
    },
  });
  const filtered = (await doc.transform()).result;
  assert("kind" in filtered && filtered.kind === "chart");
  expect(filtered.rows.map(({ x, value }) => [x, value])).toEqual([
    ["10000", 1],
  ]);
  expect(filtered.capped).toBe(false);
  expect(filtered.categories).toEqual(["sales", "web"]);
});

it("distinguishes exact empty, incomplete coverage, and a field that requires rebinding", async () => {
  const doc = await fixture(blankChart);
  await doc.stage(chartColumns, []);
  const { Group, Amount } = await doc.fieldIds();
  assert(Group && Amount);
  const spec = {
    ...blankChart.chartSpec,
    sourceCellId: doc.binding.cellId,
    xField: Group,
    yField: Amount,
  };
  await doc.save({ ...blankChart, chartSpec: spec });
  expect((await doc.transform()).result).toMatchObject({
    status: "empty",
    rows: [],
    source: { rowCount: 0 },
  });
  await doc.stage(chartColumns, [["A", 1, "web"]]);
  readBlob.mockRejectedValueOnce(new Error("Fixture result blob unavailable"));
  expect((await doc.transform()).result).toEqual({
    status: "unreadable",
    reason: "result_unreadable",
  });
  for (const coverage of ["sampled", "truncated"] as const) {
    await doc.stage(chartColumns, [["A", 1, "web"]], coverage);
    expect((await doc.transform()).result).toEqual({
      status: "blocked",
      reason: "result_incomplete",
    });
  }
  await doc.stage(
    [column("Replacement", "STRING"), ...chartColumns.slice(1)],
    [["A", 0, "web"]],
  );
  expect((await doc.transform()).result).toEqual({
    status: "blocked",
    reason: "visualization_binding_invalid",
  });
});

it("sorts and filters the full Table before delivering a stable 50-row page with full filtered totals", async () => {
  const doc = await fixture(blankChart);
  const rows = Array.from({ length: 133 }, (_, i) => [`Source ${i}`, i, "web"]);
  const resultId = await doc.stage(chartColumns, rows);
  const { Amount } = await doc.fieldIds();
  assert(Amount);
  await doc.save({
    kind: "display-table",
    dataframe: null,
    columns: [],
    tableConfig: {
      ...defaultTableConfig,
      source: doc.binding,
      sort: { fieldId: Amount, direction: "desc" },
      filters: [{ fieldId: Amount, op: "gte", value: 20 }],
      totals: { [Amount]: "sum" },
    },
  });
  const first = await doc.page(1);
  assert("rows" in first);
  expect(first).toMatchObject({
    totalRows: 113,
    page: 1,
    totals: [null, "8588.0", null],
  });
  expect(first.rows).toHaveLength(50);
  expect(first.rows[0]).toEqual(["Source 132", 132, "web"]);
  const end = await doc.page(4, resultId);
  assert("rows" in end);
  expect(end).toMatchObject({ page: 3, totalRows: 113 });
  expect(end.rows.map((row) => row[1])).toEqual([
    32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20,
  ]);
  await doc.stage(chartColumns, rows.slice(0, 7));
  expect(await doc.page(1, resultId)).toMatchObject({
    status: "stale",
    reason: "result_superseded",
  });
});

it("rolls up non-additive measures from underlying rows and drills exact matches through rename, then rejects revoked and superseded selections", async () => {
  const blank = {
    kind: "pivot",
    dataframe: null,
    rows: [],
    columns: [],
    values: [],
    pivotConfig: defaultPivotConfig,
  };
  const doc = await fixture(blank);
  const columns = [
    column("Region", "STRING"),
    column("Channel", "STRING"),
    column("Product", "STRING"),
    column("Amount", "FLOAT64"),
  ];
  const rows = [
    ["North", "web", "A", 42],
    ["North", "web", "B", 8],
    ["North", "store", "A", 12],
    ["South", "web", "B", 84],
  ];
  await doc.stage(columns, rows, undefined, authority.generation);
  const { Region, Channel, Product, Amount } = await doc.fieldIds();
  assert(Region && Channel && Product && Amount);
  const measures = (
    ["sum", "count", "average", "median", "count-distinct"] as const
  ).map((aggregation) => ({
    measureId: aggregation,
    fieldId: Amount,
    aggregation,
  }));
  const config = {
    ...defaultPivotConfig,
    source: doc.binding,
    rows: [Region],
    columns: [Channel],
    values: measures,
    subtotals: true,
  };
  await doc.save({ ...blank, pivotConfig: config });
  const first = await doc.phase1Transform("pivot");
  assert("columns" in first && first.visualizationResultId);
  expect(pivotMatrixRows(first)).toEqual(
    expect.arrayContaining([
      ["North", "web", 50, 2, 25, 25, 2],
      ["North", "store", 12, 1, 12, 12, 1],
      ["South", "web", 84, 1, 84, 84, 1],
      ["Total", "Total", 146, 4, 36.5, 27, 4],
    ]),
  );
  const north = first.rows.find((row) => row.key?.[0] === "North");
  const south = first.rows.find((row) => row.key?.[0] === "South");
  const total = first.rows.at(-1);
  const web =
    first.columns.findIndex((key) => key?.[0] === "web") * measures.length;
  const storeColumn =
    first.columns.findIndex((key) => key?.[0] === "store") * measures.length;
  expect(north?.values.slice(web, web + 2)).toMatchObject([
    { value: 50 },
    { value: 2 },
  ]);
  expect(south?.values[storeColumn]).toEqual({ kind: "missing" });
  expect(total?.values.slice(-5)).toMatchObject([
    { value: 146 },
    { value: 4 },
    { value: 36.5 },
    { value: 27 },
    { value: 4 },
  ]);
  const selection = north?.values[web];
  assert(selection?.kind === "value" && selection.selectionId);
  const request = {
    ...doc.target,
    visualizationResultId: first.visualizationResultId,
    selectionId: selection.selectionId,
    requestId: randomUUID(),
  };
  await doc.rename("regional_sales");
  const details = await doc.drill({ ...request, mode: "view-data" });
  assert("rows" in details);
  expect(details.rows.map((row) => row[3])).toEqual([42, 8]);
  expect(await doc.drill({ ...request, mode: "view-data", page: 2 })).toEqual(
    details,
  );
  await expect(
    doc.drill({ ...request, mode: "drill-down", nextFieldId: Product }),
  ).rejects.toMatchObject({ errorCode: "request_id_reused" });
  const narrowed = await doc.drill({
    ...request,
    requestId: randomUUID(),
    mode: "drill-down",
    nextFieldId: Product,
  });
  assert("rows" in narrowed);
  expect(narrowed.rows.map((row) => row.slice(0, 2))).toEqual([
    ["A", 42],
    ["B", 8],
  ]);
  readBlob.mockClear();
  expect(
    await doc.drill({ ...request, mode: "view-data" }, other),
  ).toMatchObject({ status: "denied" });
  expect(readBlob).not.toHaveBeenCalled();
  authority.generation = "2";
  expect(await doc.drill({ ...request, mode: "view-data" })).toMatchObject({
    status: "denied",
    reason: "result_source_denied",
  });
  expect(readBlob).not.toHaveBeenCalled();
  await doc.stage(columns, [
    ...rows,
    ["South", "store", "B", 0],
    ["South", "store", "A", 42],
    [null, "store", "B", null],
  ]);
  expect(await doc.drill({ ...request, mode: "view-data" })).toMatchObject({
    status: "stale",
  });
  await doc.save({
    ...blank,
    pivotConfig: { ...config, orientation: "rows", rows: [Region, Product] },
  });
  const next = (await doc.transform()).result;
  assert("rows" in next && "columns" in next);
  expect(next).toMatchObject({
    orientation: "rows",
    config: { orientation: "rows" },
  });
  expect(next.rows.some((row) => row.subtotal)).toBe(true);
  expect(
    next.rows.find((row) => row.key?.[0] === "South" && row.key[1] === "B")
      ?.values[storeColumn],
  ).toMatchObject({ kind: "value", value: 0 });
  expect(next.rows.at(-1)?.values.at(-1)).toMatchObject({
    kind: "value",
    value: 5,
  });
  expect(
    next.rows.find((row) => row.key?.[0] === null)?.values[storeColumn],
  ).toMatchObject({
    kind: "value",
    value: null,
  });
  await doc.save({
    ...blank,
    pivotConfig: {
      ...config,
      filters: [{ fieldId: Region, op: "eq", value: "West" }],
    },
  });
  expect((await doc.transform()).result).toMatchObject({
    status: "empty",
    rows: [],
    columns: [],
  });
});

it("pins a published visualization to its original E3 artifact after a draft rerun", async () => {
  const doc = await fixture(blankChart);
  await doc.stage(chartColumns, [["A", 100, "web"]]);
  const { Group, Amount } = await doc.fieldIds();
  assert(Group && Amount);
  await doc.save({
    ...blankChart,
    chartSpec: {
      ...blankChart.chartSpec,
      sourceCellId: doc.binding.cellId,
      sourceExportId: "result",
      xField: Group,
      yField: Amount,
    },
  });
  const preview = await doc.createPreview();
  assert(preview.runId);
  const original = await doc.stage(
    chartColumns,
    [["A", 146, "web"]],
    undefined,
    undefined,
    {
      identity: actor,
      runId: preview.runId,
    },
  );
  const previewQuery = {
    projectId: doc.target.projectId,
    previewId: preview.previewId,
  };
  const checked = await getPublishPreview(actor, previewQuery);
  expect(checked.state).toBe("ready");
  const previewed = (await doc.transform(undefined, actor, previewQuery))
    .result;
  assert("kind" in previewed && previewed.kind === "chart");
  expect(previewed.source.result.resultId).toBe(original);
  expect(previewed.rows[0]?.value).toBe(146);
  const released = await publishCheckedPreview(actor, {
    ...previewQuery,
    expectedHead: checked.head,
    expectedReleaseId: checked.compareReleaseId,
    expectedManifestRevision: checked.manifestRevision,
    requestId: randomUUID(),
    mode: "ready",
  });
  await doc.stage(chartColumns, [["A", 200, "web"]]);
  await getDb().insert(schema.projectShares).values({
    id: randomUUID(),
    resourceId: doc.target.projectId,
    principalType: "user",
    principalId: recipient.ownerEmail,
    role: "viewer",
    createdBy: actor.ownerEmail,
  });
  expect((await doc.transform(undefined, recipient)).result).toMatchObject({
    status: "denied",
  });
  const fixed = (await doc.transform(released.releaseId, recipient)).result;
  assert("kind" in fixed && fixed.kind === "chart");
  expect(fixed.source.result.resultId).toBe(original);
  expect(fixed.rows[0]?.value).toBe(146);
  const session = await asActor(
    () =>
      openPublishedAppSession(recipient, {
        projectId: doc.target.projectId,
        version: released.releaseId,
        openId: randomUUID(),
      }),
    recipient,
  );
  const sessionScope = { sessionId: session.sessionId };
  const refresh = await refreshPublishedAppResults(recipient, {
    sessionId: appSessionIdSchema.parse(session.sessionId),
    releaseId: releaseIdSchema.parse(released.releaseId),
    requestId: randomUUID(),
    scope: "session",
    cachePolicy: "bypass",
  });
  const privateResult = await doc.stage(
    chartColumns,
    [["A", 300, "web"]],
    undefined,
    undefined,
    { identity: recipient, runId: refresh.runId },
  );
  const refreshed = (
    await doc.transform(released.releaseId, recipient, sessionScope)
  ).result;
  assert("kind" in refreshed && refreshed.kind === "chart");
  expect(refreshed.source.result.resultId).toBe(privateResult);
  expect(refreshed.rows[0]?.value).toBe(300);
  expect(
    (await doc.transform(released.releaseId, actor, sessionScope)).result,
  ).toMatchObject({ status: "denied" });
  expect(
    (await doc.transform(released.releaseId, recipient)).result,
  ).toMatchObject({ rows: [{ value: 146 }] });
  const draft = (await doc.transform()).result;
  assert("kind" in draft && draft.kind === "chart");
  expect(draft.rows[0]?.value).toBe(200);
});

it("uses an exact date bucket and series for chart drill and removes only the selected mark", async () => {
  const doc = await fixture(blankChart);
  await doc.stage(
    [
      column("Month", "DATE"),
      column("Amount", "FLOAT64"),
      column("Segment", "STRING"),
    ],
    [
      ["2025-11-24", 42, "web"],
      ["2025-11-01", 8, "web"],
      ["2025-11-30", 12, "store"],
      ["2025-12-01", 84, "web"],
    ],
  );
  const { Month, Amount, Segment } = await doc.fieldIds();
  assert(Month && Amount && Segment);
  const spec = {
    ...blankChart.chartSpec,
    sourceCellId: doc.binding.cellId,
    sourceExportId: "result",
    xField: Month,
    yField: Amount,
    seriesField: Segment,
  };
  await doc.save({ ...blankChart, chartSpec: spec });
  const chart = (await doc.transform()).result;
  assert("kind" in chart && chart.kind === "chart");
  expect(chart.rows.map(({ x, series, value }) => [x, series, value])).toEqual([
    ["2025-11-01", "store", 12],
    ["2025-11-01", "web", 50],
    ["2025-12-01", "web", 84],
  ]);
  const mark = chart.rows.at(1);
  assert(mark);
  const request = {
    ...doc.target,
    visualizationResultId: chart.visualizationResultId,
    selectionId: mark.selectionId,
  };
  const detail = await doc.drill({
    ...request,
    requestId: randomUUID(),
    mode: "view-data",
  });
  assert("rows" in detail);
  expect(detail.rows.map((row) => row[1])).toEqual([42, 8]);
  const selection = await doc.drill({
    ...request,
    requestId: randomUUID(),
    mode: "remove",
  });
  assert("predicate" in selection && selection.predicate);
  await doc.save({
    ...blankChart,
    chartSpec: { ...spec, excludedMarks: [selection.predicate] },
  });
  const filtered = (await doc.transform()).result;
  assert("kind" in filtered && filtered.kind === "chart");
  expect(filtered.rows.map(({ value }) => value)).toEqual([12, 84]);
});
