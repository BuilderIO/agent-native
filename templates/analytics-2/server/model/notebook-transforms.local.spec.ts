import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  orgMembers,
  organizations,
  ORG_MIGRATIONS,
} from "@agent-native/core/org";
import {
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import {
  resetAppConfigForTests,
  runWithRequestContext,
} from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { cellContentsSchema } from "../../app/lib/model/contracts.js";
import { runRequestSchema } from "../../shared/notebook-execution.js";
import {
  authorizedResultRefSchema,
  resultManifestSchema,
} from "../../shared/notebook-result-contract.js";
import { defaultPivotConfig } from "../../shared/pivot-config.js";
import { SAMPLE_DATA_SOURCE_ID } from "../../shared/sample-data-contract.js";
import { defaultTableConfig } from "../../shared/table-visualization-config.js";
import { getDb, schema } from "../db/index.js";
import {
  analyticsMigrations,
  runAnalyticsMigrations,
} from "../db/migrations.js";
import {
  notebookResultFields,
  RESULT_SEGMENT_ROWS,
  stageNotebookSegment,
} from "../execution/notebook-arrow.js";
import { digest } from "./notebook-execution/planner.js";
import { createRunStore } from "./notebook-execution/run-store.js";
import { notebookResultManifests } from "./notebook-execution/schema.js";
import {
  readCurrentDraftSnapshot,
  readDraftSnapshot,
} from "./notebook-execution/snapshot.js";
import {
  getNotebookTransform,
  getNotebookVisualizationPage,
  openNotebookVisualizationDrill,
} from "./notebook-transforms.js";

vi.mock("../execution/warehouse-connector.js", async (original) => ({
  ...(await original<typeof import("../execution/warehouse-connector.js")>()),
  withWarehouseSource: async (
    _id: string,
    _actor: unknown,
    callback: (source: { generation: string }) => Promise<unknown>,
  ) => callback({ generation: authority.generation }),
}));

const authority = vi.hoisted(() => ({ generation: "1" }));

const actor = {
  orgId: "local-viz-org",
  ownerEmail: "owner@local-viz.test",
  caller: "frontend",
};
const other = { ...actor, orgId: "local-viz-other" };
const now = new Date(0).toISOString();
const store = createRunStore(readDraftSnapshot);

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
  if (!data) throw new Error("Local fixture blob unavailable");
  return { data, handle };
});

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("ANALYTICS_KERNEL_HOSTS", "");
  resetAppConfigForTests();
  await runMigrations(
    ORG_MIGRATIONS.map(({ name, ...entry }) =>
      name ? { name, ...entry } : entry,
    ),
    { table: "local_viz_org_migrations" },
  )(undefined);
  await runMigrations(
    analyticsMigrations.filter(({ version }) => version <= 25),
    { table: "analytics2_migrations" },
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
      [actor, other].map((scope) => ({
        id: randomUUID(),
        orgId: scope.orgId,
        email: scope.ownerEmail,
        joinedAt: 0,
        role: "owner" as const,
      })),
    );
  registerPrivateBlobProvider({
    id: "local-viz-test",
    name: "Local visualization fixture",
    isConfigured: () => true,
    async put({ key, data }) {
      assert(key);
      blobs.set(key, Uint8Array.from(data));
      return {
        id: key,
        provider: "local-viz-test",
        encrypted: false,
        opaque: true,
      };
    },
    read: readBlob,
    async delete(handle) {
      return {
        deleted: blobs.delete(handle.id),
        provider: "local-viz-test",
      };
    },
  });
});

afterAll(async () => {
  unregisterPrivateBlobProvider("local-viz-test");
  await closeDbExec();
  vi.unstubAllEnvs();
});

const baseCell = {
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
};

type Draft = Record<string, unknown>;
const col = (name: string, type: string) => ({ name, type });

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

async function createFixture(visualization: Draft) {
  const projectId = randomUUID();
  const versionId = randomUUID();
  const producer = randomUUID();
  const consumer = randomUUID();
  const binding = { cellId: producer, exportId: "result" };

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
    const contents = cellContentsSchema.parse({
      ...baseCell,
      ...draft,
      id,
      order,
    });
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

  async function stage(
    columns: ReturnType<typeof col>[],
    rows: unknown[][],
    authorityGeneration?: string,
  ) {
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
    const claim = await store.claim(actor, admitted.runId);
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
    const reservation = await store.renew(claim, undefined, {
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
          ownerEmail: actor.ownerEmail,
          startRow,
          page: {
            columns,
            rows: rows.slice(startRow, startRow + RESULT_SEGMENT_ROWS),
          },
          fields,
        },
        (segment) => store.recordSegment(claim, segment),
      );
    }
    const manifest = resultManifestSchema.parse({
      result: expected,
      fields,
      status: rows.length ? "complete" : "complete-empty",
      rowCount: String(rows.length),
    });
    assert(
      await store.finish(claim, {
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
            { connectionId: "local-grant", generation: authorityGeneration },
          ],
        })
        .where(eq(notebookResultManifests.id, expected.resultId));
    }
    return expected.resultId;
  }

  const target = { projectId, cellId: consumer };
  return {
    target,
    binding,
    stage,
    save: (draft: Draft) => save(consumer, "v", draft),
    transform: (identity = actor) =>
      asActor(() => getNotebookTransform(target, "frontend"), identity),
    page: (page: number, resultId?: string) =>
      asActor(() =>
        getNotebookVisualizationPage(
          { ...target, kind: "table", page, ...(resultId ? { resultId } : {}) },
          "frontend",
        ),
      ),
    drill: (
      input: Omit<
        Parameters<typeof openNotebookVisualizationDrill>[0],
        "projectId" | "cellId"
      >,
      identity = actor,
    ) =>
      asActor(
        () =>
          openNotebookVisualizationDrill({ ...target, ...input }, "frontend"),
        identity,
      ),
    async fieldIds() {
      const response = await asActor(() =>
        getNotebookTransform(target, "frontend"),
      );
      const src = response.sources[0];
      assert(src);
      return Object.fromEntries(
        src.fields.map(({ name, fieldId }) => [name, fieldId]),
      );
    },
  };
}

describe("local visualization transform fallback without analytics-kernel", () => {
  it("computes single-series, multi-series, multi-measure, and countRecords charts", async () => {
    const doc = await createFixture(blankChart);
    await doc.stage(
      [
        col("Category", "STRING"),
        col("Revenue", "FLOAT64"),
        col("Cost", "DECIMAL"),
        col("Segment", "STRING"),
      ],
      [
        ["Alpha", 100, "40.5", "web"],
        ["Alpha", 50, "20.25", "web"],
        ["Alpha", 30, "10.0", "store"],
        ["Beta", 200, "80.0", "web"],
      ],
    );
    const { Category, Revenue, Cost, Segment } = await doc.fieldIds();
    assert(Category && Revenue && Cost && Segment);

    await doc.save({
      ...blankChart,
      chartSpec: {
        ...blankChart.chartSpec,
        sourceCellId: doc.binding.cellId,
        sourceExportId: "result",
        xField: Category,
        yField: Revenue,
        yAggregation: "sum",
      },
    });
    const single = (await doc.transform()).result;
    assert(
      "kind" in single && single.kind === "chart" && single.status === "ready",
    );
    expect(
      single.rows.map(({ x, series, value }) => [x, series, value]),
    ).toEqual([
      ["Alpha", null, 180],
      ["Beta", null, 200],
    ]);

    await doc.save({
      ...blankChart,
      chartSpec: {
        ...blankChart.chartSpec,
        sourceCellId: doc.binding.cellId,
        sourceExportId: "result",
        xField: Category,
        yField: Revenue,
        seriesField: Segment,
        yAggregation: "sum",
      },
    });
    const multiSeries = (await doc.transform()).result;
    assert(
      "kind" in multiSeries &&
        multiSeries.kind === "chart" &&
        multiSeries.status === "ready",
    );
    expect(
      multiSeries.rows.map(({ x, series, value }) => [x, series, value]),
    ).toEqual([
      ["Alpha", "store", 30],
      ["Alpha", "web", 150],
      ["Beta", "web", 200],
    ]);
    expect(multiSeries.categories).toEqual(["store", "web"]);

    await doc.save({
      ...blankChart,
      chartSpec: {
        ...blankChart.chartSpec,
        sourceCellId: doc.binding.cellId,
        sourceExportId: "result",
        xField: Category,
        yField: Revenue,
        yFields: [Revenue, Cost],
        seriesField: null,
        yAggregation: "sum",
      },
    });
    const multiMeasure = (await doc.transform()).result;
    assert(
      "kind" in multiMeasure &&
        multiMeasure.kind === "chart" &&
        multiMeasure.status === "ready",
    );
    expect(
      multiMeasure.rows.map(({ x, series, value }) => [x, series, value]),
    ).toEqual([
      ["Alpha", "Cost", 70.75],
      ["Alpha", "Revenue", 180],
      ["Beta", "Cost", 80],
      ["Beta", "Revenue", 200],
    ]);

    await doc.save({
      ...blankChart,
      chartSpec: {
        ...blankChart.chartSpec,
        sourceCellId: doc.binding.cellId,
        sourceExportId: "result",
        mark: "pie",
        xField: Category,
        yField: Revenue,
        yFields: [Revenue, Cost],
        seriesField: null,
        yAggregation: "sum",
      },
    });
    const pie = (await doc.transform()).result;
    assert("kind" in pie && pie.kind === "chart" && pie.status === "ready");
    expect(pie.rows.map(({ x, series, value }) => [x, series, value])).toEqual([
      ["Alpha", null, 180],
      ["Beta", null, 200],
    ]);

    await doc.save({
      ...blankChart,
      chartSpec: {
        ...blankChart.chartSpec,
        sourceCellId: doc.binding.cellId,
        sourceExportId: "result",
        xField: Category,
        yField: null,
        countRecords: true,
        seriesField: null,
      },
    });
    const counted = (await doc.transform()).result;
    assert(
      "kind" in counted &&
        counted.kind === "chart" &&
        counted.status === "ready",
    );
    expect(counted.rows.map(({ x, value }) => [x, value])).toEqual([
      ["Alpha", 3],
      ["Beta", 1],
    ]);
  });

  it("buckets date and datetime xTimeUnit accurately in UTC", async () => {
    const doc = await createFixture(blankChart);
    await doc.stage(
      [col("Day", "DATE"), col("Ts", "TIMESTAMP"), col("Amount", "INT64")],
      [
        ["2025-11-23", "2025-11-23T10:15:30Z", 10],
        ["2025-11-24", "2025-11-24T10:45:00Z", 20],
        ["2025-12-02", "2025-12-02T14:00:00Z", 30],
        ["2026-02-10", "2026-02-10T08:00:00Z", 40],
      ],
    );
    const { Day, Ts, Amount } = await doc.fieldIds();
    assert(Day && Ts && Amount);

    const checkDateUnit = async (
      fieldId: string,
      xTimeUnit: "day" | "week" | "month" | "quarter" | "year" | "none",
    ) => {
      await doc.save({
        ...blankChart,
        chartSpec: {
          ...blankChart.chartSpec,
          sourceCellId: doc.binding.cellId,
          sourceExportId: "result",
          xField: fieldId,
          xTimeUnit,
          yField: Amount,
          yAggregation: "sum",
        },
      });
      const res = (await doc.transform()).result;
      assert("kind" in res && res.kind === "chart" && res.status === "ready");
      return res.rows.map(({ x, value }) => [x, value]);
    };

    expect(await checkDateUnit(Day, "day")).toEqual([
      ["2025-11-23", 10],
      ["2025-11-24", 20],
      ["2025-12-02", 30],
      ["2026-02-10", 40],
    ]);
    expect(await checkDateUnit(Day, "week")).toEqual([
      ["2025-11-17", 10],
      ["2025-11-24", 20],
      ["2025-12-01", 30],
      ["2026-02-09", 40],
    ]);
    expect(await checkDateUnit(Day, "month")).toEqual([
      ["2025-11-01", 30],
      ["2025-12-01", 30],
      ["2026-02-01", 40],
    ]);
    expect(await checkDateUnit(Day, "quarter")).toEqual([
      ["2025-10-01", 60],
      ["2026-01-01", 40],
    ]);
    expect(await checkDateUnit(Day, "year")).toEqual([
      ["2025-01-01", 60],
      ["2026-01-01", 40],
    ]);
    expect(await checkDateUnit(Day, "none")).toEqual([
      ["2025-11-23", 10],
      ["2025-11-24", 20],
      ["2025-12-02", 30],
      ["2026-02-10", 40],
    ]);

    expect(await checkDateUnit(Ts, "month")).toEqual([
      ["2025-11-01 00:00:00", 30],
      ["2025-12-01 00:00:00", 30],
      ["2026-02-01 00:00:00", 40],
    ]);
    expect(await checkDateUnit(Ts, "none")).toEqual([
      ["2025-11-23 10:15:30", 10],
      ["2025-11-24 10:45:00", 20],
      ["2025-12-02 14:00:00", 30],
      ["2026-02-10 08:00:00", 40],
    ]);
  });

  it("evaluates all filter operators, excludedMarks, and chart aggregations", async () => {
    const doc = await createFixture(blankChart);
    await doc.stage(
      [col("Group", "STRING"), col("Amount", "FLOAT64"), col("Tag", "STRING")],
      [
        ["A", 10, "north-web"],
        ["A", 20, "north-web"],
        ["A", 20, "north-store"],
        ["A", 50, "south-web"],
        ["B", 100, null],
        ["C", 5, "west-web"],
      ],
    );
    const { Group, Amount, Tag } = await doc.fieldIds();
    assert(Group && Amount && Tag);

    const runAgg = async (
      yAggregation:
        | "sum"
        | "average"
        | "count"
        | "distinct_count"
        | "min"
        | "max"
        | "median"
        | "none",
      filters: unknown[] = [],
      excludedMarks: unknown[][] = [],
    ) => {
      await doc.save({
        ...blankChart,
        chartSpec: {
          ...blankChart.chartSpec,
          sourceCellId: doc.binding.cellId,
          sourceExportId: "result",
          xField: Group,
          yField: Amount,
          yAggregation,
          filters,
          excludedMarks,
        },
      });
      const res = (await doc.transform()).result;
      assert("kind" in res && res.kind === "chart" && res.status === "ready");
      return res.rows.map(({ x, value }) => [x, value]);
    };

    expect(await runAgg("sum")).toEqual([
      ["A", 100],
      ["B", 100],
      ["C", 5],
    ]);
    expect(await runAgg("average")).toEqual([
      ["A", 25],
      ["B", 100],
      ["C", 5],
    ]);
    expect(await runAgg("count")).toEqual([
      ["A", 4],
      ["B", 1],
      ["C", 1],
    ]);
    expect(await runAgg("distinct_count")).toEqual([
      ["A", 3],
      ["B", 1],
      ["C", 1],
    ]);
    expect(await runAgg("min")).toEqual([
      ["A", 10],
      ["B", 100],
      ["C", 5],
    ]);
    expect(await runAgg("max")).toEqual([
      ["A", 50],
      ["B", 100],
      ["C", 5],
    ]);
    expect(await runAgg("median")).toEqual([
      ["A", 20],
      ["B", 100],
      ["C", 5],
    ]);
    expect(await runAgg("none")).toEqual([
      ["A", 10],
      ["A", 20],
      ["A", 20],
      ["A", 50],
      ["B", 100],
      ["C", 5],
    ]);

    expect(
      await runAgg("sum", [{ fieldId: Group, op: "eq", value: "A" }]),
    ).toEqual([["A", 100]]);
    expect(
      await runAgg("sum", [{ fieldId: Group, op: "neq", value: "A" }]),
    ).toEqual([
      ["B", 100],
      ["C", 5],
    ]);
    expect(
      await runAgg("sum", [{ fieldId: Group, op: "in", values: ["A", "C"] }]),
    ).toEqual([
      ["A", 100],
      ["C", 5],
    ]);
    expect(
      await runAgg("sum", [
        { fieldId: Amount, op: "gte", value: 20 },
        { fieldId: Amount, op: "lt", value: 100 },
      ]),
    ).toEqual([["A", 90]]);
    expect(
      await runAgg("sum", [{ fieldId: Tag, op: "contains", value: "NORTH" }]),
    ).toEqual([["A", 50]]);
    expect(await runAgg("sum", [{ fieldId: Tag, op: "is-null" }])).toEqual([
      ["B", 100],
    ]);
    expect(
      await runAgg("sum", [], [[{ fieldId: Group, op: "eq", value: "B" }]]),
    ).toEqual([
      ["A", 100],
      ["C", 5],
    ]);

    await doc.save({
      ...blankChart,
      chartSpec: {
        ...blankChart.chartSpec,
        sourceCellId: doc.binding.cellId,
        sourceExportId: "result",
        xField: Group,
        yField: Tag,
        yAggregation: "sum",
      },
    });
    expect((await doc.transform()).result).toEqual({
      status: "blocked",
      reason: "visualization_binding_invalid",
    });
  });

  it("handles display-table paging, sorting, and totals without kernel", async () => {
    const doc = await createFixture(blankChart);
    const rows = Array.from({ length: 120 }, (_, i) => [
      `Item ${i}`,
      i % 10 === 0 ? null : i,
      "web",
    ]);
    const resultId = await doc.stage(
      [
        col("Name", "STRING"),
        col("Amount", "FLOAT64"),
        col("Channel", "STRING"),
      ],
      rows,
    );
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

    const page1 = await doc.page(1, resultId);
    assert("rows" in page1);
    expect(page1.totalRows).toBe(90);
    expect(page1.page).toBe(1);
    expect(page1.rows).toHaveLength(50);
    expect(page1.rows[0]).toEqual(["Item 119", 119, "web"]);
    expect(page1.totals).toEqual([null, "6300.0", null]);

    const page2 = await doc.page(5, resultId);
    assert("rows" in page2);
    expect(page2.page).toBe(2);
    expect(page2.rows).toHaveLength(40);
    expect(page2.rows.at(-1)).toEqual(["Item 21", 21, "web"]);
  });

  it("computes pivot grouping sets, subtotals, totals, and drill-down / view-data", async () => {
    const blankPivot: Draft = {
      kind: "pivot",
      dataframe: null,
      rows: [],
      columns: [],
      values: [],
      pivotConfig: defaultPivotConfig,
    };
    const doc = await createFixture(blankPivot);
    await doc.stage(
      [
        col("Region", "STRING"),
        col("Product", "STRING"),
        col("Channel", "STRING"),
        col("Amount", "FLOAT64"),
      ],
      [
        ["North", "A", "web", 42],
        ["North", "B", "web", 8],
        ["North", "A", "store", 12],
        ["South", "B", "web", 84],
      ],
      authority.generation,
    );
    const { Region, Product, Channel, Amount } = await doc.fieldIds();
    assert(Region && Product && Channel && Amount);

    const measures = (
      ["sum", "count", "average", "median", "count-distinct"] as const
    ).map((aggregation) => ({
      measureId: aggregation,
      fieldId: Amount,
      aggregation,
    }));
    await doc.save({
      ...blankPivot,
      pivotConfig: {
        ...defaultPivotConfig,
        source: doc.binding,
        rows: [Region, Product],
        columns: [Channel],
        values: measures,
        subtotals: true,
        rowTotals: true,
        columnTotals: true,
      },
    });

    const pivotRes = (await doc.transform()).result;
    assert("columns" in pivotRes && pivotRes.status === "ready");
    expect(pivotRes.rows.some((row) => row.subtotal)).toBe(true);
    const grandTotal = pivotRes.rows.at(-1);
    expect(grandTotal?.key).toBeNull();
    expect(grandTotal?.values.slice(-5)).toMatchObject([
      { kind: "value", value: 146 },
      { kind: "value", value: 4 },
      { kind: "value", value: 36.5 },
      { kind: "value", value: 27 },
      { kind: "value", value: 4 },
    ]);

    const northSubtotal = pivotRes.rows.find(
      (row) => row.subtotal && row.key?.[0] === "North",
    );
    const webIdx =
      pivotRes.columns.findIndex((c) => c?.[0] === "web") * measures.length;
    const cell = northSubtotal?.values[webIdx];
    assert(
      cell?.kind === "value" &&
        cell.selectionId &&
        pivotRes.visualizationResultId,
    );

    const details = await doc.drill({
      visualizationResultId: pivotRes.visualizationResultId,
      selectionId: cell.selectionId,
      requestId: randomUUID(),
      mode: "view-data",
    });
    assert("rows" in details);
    expect(details.rows.map((r) => r[3])).toEqual([42, 8]);

    readBlob.mockClear();
    expect(
      await doc.drill(
        {
          visualizationResultId: pivotRes.visualizationResultId,
          selectionId: cell.selectionId,
          requestId: randomUUID(),
          mode: "view-data",
        },
        other,
      ),
    ).toMatchObject({ status: "denied" });
    expect(readBlob).not.toHaveBeenCalled();
  });

  it("supports chart drill-down and view-data with date bucketing and excludedMarks", async () => {
    const doc = await createFixture(blankChart);
    await doc.stage(
      [
        col("Month", "DATE"),
        col("Amount", "FLOAT64"),
        col("Segment", "STRING"),
        col("Product", "STRING"),
      ],
      [
        ["2025-11-24", 42, "web", "P1"],
        ["2025-11-01", 8, "web", "P2"],
        ["2025-11-30", 12, "store", "P1"],
        ["2025-12-01", 84, "web", "P1"],
      ],
    );
    const { Month, Amount, Segment, Product } = await doc.fieldIds();
    assert(Month && Amount && Segment && Product);

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
    assert(
      "kind" in chart && chart.kind === "chart" && chart.status === "ready",
    );
    expect(
      chart.rows.map(({ x, series, value }) => [x, series, value]),
    ).toEqual([
      ["2025-11-01", "store", 12],
      ["2025-11-01", "web", 50],
      ["2025-12-01", "web", 84],
    ]);

    const mark = chart.rows[1];
    assert(mark);
    const viewData = await doc.drill({
      visualizationResultId: chart.visualizationResultId,
      selectionId: mark.selectionId,
      requestId: randomUUID(),
      mode: "view-data",
    });
    assert("rows" in viewData);
    expect(viewData.rows.map((r) => r[1])).toEqual([42, 8]);

    const drillDown = await doc.drill({
      visualizationResultId: chart.visualizationResultId,
      selectionId: mark.selectionId,
      requestId: randomUUID(),
      mode: "drill-down",
      nextFieldId: Product,
    });
    assert("rows" in drillDown);
    expect(drillDown.rows).toEqual([
      ["P1", 42],
      ["P2", 8],
    ]);

    const removeSel = await doc.drill({
      visualizationResultId: chart.visualizationResultId,
      selectionId: mark.selectionId,
      requestId: randomUUID(),
      mode: "remove",
    });
    assert("predicate" in removeSel && removeSel.predicate);
    await doc.save({
      ...blankChart,
      chartSpec: { ...spec, excludedMarks: [removeSel.predicate] },
    });
    const afterExclude = (await doc.transform()).result;
    assert(
      "kind" in afterExclude &&
        afterExclude.kind === "chart" &&
        afterExclude.status === "ready",
    );
    expect(afterExclude.rows.map(({ value }) => value)).toEqual([12, 84]);
  });

  it("handles datetime sub-day bucketing, datetime drill/exclude, stddev/variance, pivot drill-down, NULL SQL semantics, and empty results", async () => {
    const doc = await createFixture(blankChart);
    await doc.stage(
      [
        col("Ts", "TIMESTAMP"),
        col("Amount", "FLOAT64"),
        col("Tag", "STRING"),
        col("Product", "STRING"),
      ],
      [
        ["2025-11-24T10:15:00Z", 10, "north", "P1"],
        ["2025-11-24T10:45:00Z", 20, "south", "P2"],
        ["2025-11-24T11:05:00Z", 30, null, "P1"],
      ],
    );
    const { Ts, Amount, Tag, Product } = await doc.fieldIds();
    assert(Ts && Amount && Tag && Product);

    const spec = {
      ...blankChart.chartSpec,
      sourceCellId: doc.binding.cellId,
      sourceExportId: "result",
      xField: Ts,
      xTimeUnit: "hour" as const,
      yField: Amount,
      yAggregation: "sum" as const,
    };
    await doc.save({ ...blankChart, chartSpec: spec });
    const hourly = (await doc.transform()).result;
    assert(
      "kind" in hourly && hourly.kind === "chart" && hourly.status === "ready",
    );
    expect(hourly.rows.map(({ x, value }) => [x, value])).toEqual([
      ["2025-11-24 10:00:00", 30],
      ["2025-11-24 11:00:00", 30],
    ]);

    const hourMark = hourly.rows[0];
    assert(hourMark);
    const hourData = await doc.drill({
      visualizationResultId: hourly.visualizationResultId,
      selectionId: hourMark.selectionId,
      requestId: randomUUID(),
      mode: "view-data",
    });
    assert("rows" in hourData);
    expect(hourData.rows.map((r) => r[1])).toEqual([10, 20]);

    const hourExclude = await doc.drill({
      visualizationResultId: hourly.visualizationResultId,
      selectionId: hourMark.selectionId,
      requestId: randomUUID(),
      mode: "remove",
    });
    assert("predicate" in hourExclude && hourExclude.predicate);
    await doc.save({
      ...blankChart,
      chartSpec: { ...spec, excludedMarks: [hourExclude.predicate] },
    });
    const afterHourExclude = (await doc.transform()).result;
    assert(
      "kind" in afterHourExclude &&
        afterHourExclude.kind === "chart" &&
        afterHourExclude.status === "ready",
    );
    expect(afterHourExclude.rows.map(({ x, value }) => [x, value])).toEqual([
      ["2025-11-24 11:00:00", 30],
    ]);

    await doc.save({
      ...blankChart,
      chartSpec: {
        ...spec,
        xField: Product,
        xTimeUnit: "none",
        yAggregation: "variance",
      },
    });
    const varSamp = (await doc.transform()).result;
    assert(
      "kind" in varSamp &&
        varSamp.kind === "chart" &&
        varSamp.status === "ready",
    );
    expect(varSamp.rows.map(({ x, value }) => [x, value])).toEqual([
      ["P1", 200],
      ["P2", null],
    ]);

    await doc.save({
      ...blankChart,
      chartSpec: {
        ...spec,
        xField: Product,
        xTimeUnit: "none",
        yAggregation: "stddevpop",
      },
    });
    const sdPop = (await doc.transform()).result;
    assert(
      "kind" in sdPop && sdPop.kind === "chart" && sdPop.status === "ready",
    );
    expect(sdPop.rows.map(({ x, value }) => [x, value])).toEqual([
      ["P1", 10],
      ["P2", 0],
    ]);

    await doc.save({
      ...blankChart,
      chartSpec: {
        ...spec,
        xField: Product,
        xTimeUnit: "none",
        yAggregation: "sum",
        filters: [{ fieldId: Tag, op: "not-contains", value: "north" }],
      },
    });
    const notContains = (await doc.transform()).result;
    assert(
      "kind" in notContains &&
        notContains.kind === "chart" &&
        notContains.status === "ready",
    );
    expect(notContains.rows.map(({ x, value }) => [x, value])).toEqual([
      ["P2", 20],
    ]);

    await doc.save({
      kind: "pivot",
      dataframe: null,
      rows: [],
      columns: [],
      values: [],
      pivotConfig: {
        ...defaultPivotConfig,
        source: doc.binding,
        rows: [Product],
        columns: [],
        values: [{ measureId: "sum", fieldId: Amount, aggregation: "sum" }],
      },
    });
    const pivot = (await doc.transform()).result;
    assert("columns" in pivot && pivot.status === "ready");
    const p1Cell = pivot.rows.find((r) => r.key?.[0] === "P1")?.values[0];
    assert(
      p1Cell?.kind === "value" &&
        p1Cell.selectionId &&
        pivot.visualizationResultId,
    );
    const pivotDrill = await doc.drill({
      visualizationResultId: pivot.visualizationResultId,
      selectionId: p1Cell.selectionId,
      requestId: randomUUID(),
      mode: "drill-down",
      nextFieldId: Tag,
    });
    assert("rows" in pivotDrill);
    expect(pivotDrill.rows).toEqual([
      [null, 30],
      ["north", 10],
    ]);

    await doc.stage(
      [
        col("Ts", "TIMESTAMP"),
        col("Amount", "FLOAT64"),
        col("Tag", "STRING"),
        col("Product", "STRING"),
      ],
      [],
    );
    await doc.save({
      kind: "display-table",
      dataframe: null,
      columns: [],
      tableConfig: {
        ...defaultTableConfig,
        source: doc.binding,
        sort: null,
        filters: [],
        totals: { [Amount]: "sum", [Tag]: "count" },
      },
    });
    const emptyPage = await doc.page(1);
    assert("rows" in emptyPage);
    expect(emptyPage).toMatchObject({
      status: "empty",
      totalRows: 0,
      page: 1,
      rows: [],
      totals: [null, null, "0", null],
    });
  });

  it("returns the computed chart transform uncached when no writable private blob provider is configured", async () => {
    const doc = await createFixture(blankChart);
    await doc.stage(
      [
        col("date", "STRING"),
        col("template", "STRING"),
        col("visitors", "INT64"),
      ],
      [
        ["2026-10-01", "mail-2", 42],
        ["2026-10-02", "mail-2", 55],
        ["2026-10-02", "calendar-2", 18],
      ],
    );
    const { date, template, visitors } = await doc.fieldIds();
    assert(date && template && visitors);
    await doc.save({
      ...blankChart,
      chartSpec: {
        ...blankChart.chartSpec,
        sourceCellId: doc.binding.cellId,
        sourceExportId: "result",
        mark: "area",
        stacked: true,
        xField: date,
        yField: visitors,
        yFields: [visitors],
        seriesField: template,
      },
    });

    unregisterPrivateBlobProvider("local-viz-test");
    registerPrivateBlobProvider({
      id: "local-viz-test",
      name: "Read-only visualization fixture",
      isConfigured: () => false,
      async put() {
        throw new Error("put should not be called when isConfigured is false");
      },
      read: readBlob,
      async delete() {
        return { deleted: false, provider: "local-viz-test" };
      },
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const response = await doc.transform();
      assert(
        "kind" in response.result &&
          response.result.kind === "chart" &&
          response.result.status === "ready",
      );
      expect(
        response.result.rows.map(({ x, series, value }) => [x, series, value]),
      ).toEqual([
        ["2026-10-01", "mail-2", 42],
        ["2026-10-02", "calendar-2", 18],
        ["2026-10-02", "mail-2", 55],
      ]);
      expect(response.result.categories).toEqual(["calendar-2", "mail-2"]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("visualization cache storage unavailable"),
        expect.objectContaining({
          projectId: doc.target.projectId,
          cellId: doc.target.cellId,
        }),
      );
    } finally {
      warnSpy.mockRestore();
      unregisterPrivateBlobProvider("local-viz-test");
      registerPrivateBlobProvider({
        id: "local-viz-test",
        name: "Local visualization fixture",
        isConfigured: () => true,
        async put({ key, data }) {
          assert(key);
          blobs.set(key, Uint8Array.from(data));
          return {
            id: key,
            provider: "local-viz-test",
            encrypted: false,
            opaque: true,
          };
        },
        read: readBlob,
        async delete(handle) {
          return {
            deleted: blobs.delete(handle.id),
            provider: "local-viz-test",
          };
        },
      });
    }
  });
});
