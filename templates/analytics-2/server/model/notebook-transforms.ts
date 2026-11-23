import { createHash, randomUUID } from "node:crypto";

import { fail, isActionContractError } from "@agent-native/core/action";
import {
  deletePrivateBlob,
  isPrivateBlobError,
  putPrivateBlob,
  readPrivateBlob,
} from "@agent-native/core/private-blob";
import { and, eq, gt, lte } from "drizzle-orm";
import { z } from "zod";

import type { ChartSpec } from "../../app/lib/model/contracts.js";
import { migrateChartSpec } from "../../shared/chart-visualization-config.js";
import {
  defaultMetricAggregation,
  metricAggregations,
  type MetricConfig,
} from "../../shared/metric-config.js";
import {
  resultFieldSchema,
  type ResultField,
} from "../../shared/notebook-result-contract.js";
import {
  defaultPivotConfig,
  pivotScalarSchema,
  type PivotConfig,
  type PivotConfigV2,
  type PivotScalar,
} from "../../shared/pivot-config.js";
import {
  tableFilterSchema,
  type TableFilter,
} from "../../shared/table-visualization-config.js";
import {
  notebookTransformSchema,
  type ChartTransformResult,
  type MetricTransformResult,
  type NotebookTransform,
  type PivotTransformResult,
  type TransformSource,
  type VisualizationDrillInput,
  type VisualizationFailure,
  type VisualizationDrillOutput,
  type VisualizationPageInput,
  type VisualizationPageOutput,
} from "../../shared/visualization-contracts.js";
import { getDb } from "../db/index.js";
import { KernelGatewayError } from "../execution/kernel-client.js";
import { notebookResultBlobPurpose } from "../execution/local-notebook-blob.js";
import {
  runLocalChartDrillTransform,
  runLocalChartTransform,
  runLocalMetricTransform,
  runLocalPivotTransform,
  runLocalTablePageTransform,
} from "../execution/local-visualization-transform.js";
import {
  executeVisualizationSql,
  VisualizationResultLimit,
} from "../execution/visualization-kernel.js";
import {
  visualizationSql,
  VisualizationBindingError,
  VISUALIZATION_GROUP_LIMIT,
} from "../execution/visualization-sql.js";
import { digest } from "./notebook-execution/planner.js";
import type { ExecutionActor } from "./notebook-execution/snapshot.js";
import { currentResultActor } from "./notebook-results.js";
import {
  visualizationDrills,
  visualizationPalettes,
  visualizationResults,
} from "./visualization-schema.js";
import {
  conflict,
  denied,
  invalid,
  readVisualizationCell,
  resolveVisualizationProducer,
  stale,
  unconfigured,
  unreadable,
  type VisualizationCell,
  type VisualizationProducer,
} from "./visualization-source.js";

const resultTtl = 15 * 60 * 1000;

class VisualizationSourceChanged extends Error {
  constructor(readonly failure: VisualizationFailure) {
    super(failure.status);
  }
}
const scalarList = z.array(pivotScalarSchema);
const selectionsSchema = z.record(z.string(), z.array(tableFilterSchema));
const cacheSchema = z.strictObject({
  result: notebookTransformSchema.shape.result,
  selections: selectionsSchema,
});
type Selections = z.infer<typeof selectionsSchema>;
type ComputedView = z.infer<typeof cacheSchema>;

function bindingFor(view: VisualizationCell) {
  const { contents } = view;
  if (contents.kind === "pivot") {
    const source = contents.pivotConfig?.source;
    return source
      ? {
          cellId: source.cellId,
          exportId: source.exportId === "table" ? "result" : source.exportId,
        }
      : null;
  }
  if (contents.kind === "display-table")
    return contents.tableConfig?.source ?? null;
  if (contents.kind === "metric") return contents.metricConfig?.source ?? null;
  if (contents.kind !== "chart") return null;
  if (contents.chartSpec.sourceCellId)
    return {
      cellId: contents.chartSpec.sourceCellId,
      exportId: contents.chartSpec.sourceExportId ?? "result",
    };
  return contents.dataframe ? { name: contents.dataframe } : null;
}

function transformSource(producer: VisualizationProducer): TransformSource {
  return {
    result: producer.manifest.result,
    fields: producer.fields,
    completeness: "complete",
    rowCount: producer.rowCount,
  };
}

function materializePivot(
  config: PivotConfig,
  producer: VisualizationProducer,
): PivotConfigV2 {
  if (config.version === 2) return config;
  const { cellId, exportId } = producer.option.binding;
  function fieldId(id: string) {
    const matches = producer.fields.filter(({ fieldId, name, type }) => {
      const legacyType =
        type === "integer" || type === "decimal" ? "number" : type;
      const legacy = createHash("sha256")
        .update(JSON.stringify([cellId, "table", name, legacyType]))
        .digest("hex");
      return id === fieldId || id === legacy || id === name;
    });
    const field = matches.length === 1 ? matches[0] : undefined;
    if (!field)
      throw new VisualizationBindingError("Pivot field needs a replacement");
    return field.fieldId;
  }
  return {
    ...config,
    version: 2,
    source: { cellId, exportId },
    rows: config.rows.map(fieldId),
    columns: config.columns.map(fieldId),
    values: config.values.map((measure, index) => ({
      ...measure,
      fieldId: fieldId(measure.fieldId),
      measureId: digest([measure.fieldId, measure.aggregation, index]),
    })),
    filters: config.filters.map((filter) => ({
      ...filter,
      fieldId: fieldId(filter.fieldId),
    })),
    orientation: "columns",
    subtotals: false,
  };
}

function selection(selections: Selections, filters: TableFilter[]) {
  const key = digest(filters);
  selections[key] = filters;
  return key;
}

function eqFilter(fieldId: string, value: PivotScalar): TableFilter {
  return value === null
    ? { fieldId, op: "is-null" }
    : { fieldId, op: "eq", value };
}

type Bucket = Exclude<ChartSpec["xTimeUnit"], "none" | undefined>;
function timeFilter(
  field: ResultField,
  start: string,
  unit: Bucket,
): TableFilter[] {
  const end = new Date(
    start.replace(" ", "T") + (start.length === 10 ? "" : "Z"),
  );
  switch (unit) {
    case "year":
      end.setUTCFullYear(end.getUTCFullYear() + 1);
      break;
    case "quarter":
      end.setUTCMonth(end.getUTCMonth() + 3);
      break;
    case "month":
      end.setUTCMonth(end.getUTCMonth() + 1);
      break;
    case "week":
      end.setUTCDate(end.getUTCDate() + 7);
      break;
    case "day":
      end.setUTCDate(end.getUTCDate() + 1);
      break;
    case "hour":
      end.setUTCHours(end.getUTCHours() + 1);
      break;
    case "minute":
      end.setUTCMinutes(end.getUTCMinutes() + 1);
      break;
    case "second":
      end.setUTCSeconds(end.getUTCSeconds() + 1);
      break;
  }
  return [
    { fieldId: field.fieldId, op: "gte", value: start },
    {
      fieldId: field.fieldId,
      op: "lt",
      value:
        field.type === "date"
          ? end.toISOString().slice(0, 10)
          : end.toISOString(),
    },
  ];
}

async function stableCategories(bindingKey: string, categories: PivotScalar[]) {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx
      .insert(visualizationPalettes)
      .values({ bindingKey, categories: [] })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(visualizationPalettes)
      .where(eq(visualizationPalettes.bindingKey, bindingKey))
      .limit(1)
      .for("update");
    const existing = scalarList.parse(row?.categories);
    const domain = [...new Set([...existing, ...categories])].slice(
      0,
      VISUALIZATION_GROUP_LIMIT,
    );
    if (domain.length !== existing.length)
      await tx
        .update(visualizationPalettes)
        .set({ categories: domain })
        .where(eq(visualizationPalettes.bindingKey, bindingKey));
    return domain;
  });
}

async function assertCurrentSource(
  actor: ExecutionActor,
  view: VisualizationCell,
  producer: VisualizationProducer,
) {
  const current = await readVisualizationCell(actor, view.target);
  if ("status" in current) throw new VisualizationSourceChanged(current);
  if (
    current.versionId !== view.versionId ||
    current.configDigest !== view.configDigest
  )
    throw new VisualizationSourceChanged(conflict);
  const { resolved } = await resolveVisualizationProducer(
    actor,
    current,
    producer.option.binding,
    false,
  );
  if (!("manifest" in resolved)) throw new VisualizationSourceChanged(resolved);
  if (resolved.manifest.result.resultId !== producer.manifest.result.resultId)
    throw new VisualizationSourceChanged(stale);
}

function isKernelUnavailable(error: unknown) {
  return (
    error instanceof KernelGatewayError &&
    (error.code === "not_configured" || error.code === "host_unavailable")
  );
}

async function query(
  actor: ExecutionActor,
  view: VisualizationCell,
  producer: VisualizationProducer,
  source: string,
  fallback: () => Promise<unknown[]>,
) {
  try {
    return await executeVisualizationSql({
      actor,
      source,
      versionId: view.versionId,
      released: Boolean(view.target.releaseId),
      manifest: producer.manifest,
      readInput: producer.stream,
      async authorize() {
        await assertCurrentSource(actor, view, producer);
        return true;
      },
    });
  } catch (error) {
    if (!isKernelUnavailable(error)) throw error;
    await assertCurrentSource(actor, view, producer);
    const result = await fallback();
    await assertCurrentSource(actor, view, producer);
    return result;
  }
}

async function chartView(
  actor: ExecutionActor,
  view: VisualizationCell,
  producer: VisualizationProducer,
  config: ChartSpec,
  visualizationResultId: string,
) {
  const { source, bucket } = visualizationSql(producer.fields).chart(config);
  const raw = await query(actor, view, producer, source, () =>
    runLocalChartTransform(
      producer.manifest,
      producer.fields,
      producer.stream,
      config,
    ),
  );
  const selections: Selections = {};
  const marks: ChartTransformResult["rows"] = [];
  const categories: PivotScalar[] = [];
  const xField = producer.fields.find(
    (field) => field.fieldId === config.xField,
  );
  if (!xField)
    throw new VisualizationBindingError("Chart field needs a replacement");
  const chartRow = z.tuple([
    z.union([z.literal(0), z.literal(1)]),
    pivotScalarSchema,
    pivotScalarSchema,
    z.number().nullable(),
  ]);
  for (const value of raw) {
    const [kind, x, series, y] = chartRow.parse(value);
    if (kind === 1) {
      categories.push(x);
      continue;
    }
    if (marks.length > VISUALIZATION_GROUP_LIMIT)
      throw new VisualizationResultLimit();
    const filters =
      bucket && typeof x === "string"
        ? timeFilter(xField, x, bucket)
        : [eqFilter(xField.fieldId, x)];
    if (config.seriesField) filters.push(eqFilter(config.seriesField, series));
    marks.push({
      x,
      series,
      value: y,
      selectionId: selection(selections, filters),
    });
  }
  const domain = config.seriesField
    ? await stableCategories(
        digest([
          actor.orgId,
          view.target.projectId,
          view.target.cellId,
          producer.option.binding.cellId,
          producer.option.binding.exportId,
          config.seriesField,
        ]),
        categories,
      )
    : [];
  const result: ChartTransformResult = {
    kind: "chart",
    status: marks.length ? "ready" : "empty",
    source: transformSource(producer),
    rows: marks.slice(0, VISUALIZATION_GROUP_LIMIT),
    categories: domain,
    capped: marks.length > VISUALIZATION_GROUP_LIMIT,
    visualizationResultId,
  };
  return { result, selections };
}

const pivotGroup = z.tuple([
  z.array(z.union([z.literal(0), z.literal(1)])),
  scalarList,
  z.array(z.number().nullable()),
]);

type Axis = { path: PivotScalar[]; rolledUp: number };
function axisKey(axis: Axis) {
  return JSON.stringify([axis.rolledUp, axis.path]);
}
function axisValue(axis: Axis) {
  return axis.rolledUp && !axis.path.length ? null : axis.path;
}

async function pivotView(
  actor: ExecutionActor,
  view: VisualizationCell,
  producer: VisualizationProducer,
  config: PivotConfigV2,
  visualizationResultId: string,
  rowPage: number,
  columnPage: number,
) {
  const raw = await query(
    actor,
    view,
    producer,
    visualizationSql(producer.fields).pivot(config),
    () =>
      runLocalPivotTransform(
        producer.manifest,
        producer.fields,
        producer.stream,
        config,
      ),
  );
  const rowKeys = new Map<string, Axis>();
  const columnKeys = new Map<string, Axis>();
  const grid = new Map<
    string,
    { values: (number | null)[]; selectionId: string }
  >();
  const selections: Selections = {};
  const fields = [...config.rows, ...config.columns];
  for (const group of raw.slice(0, VISUALIZATION_GROUP_LIMIT)) {
    const [omitted, keys, values] = pivotGroup.parse(group);
    if (
      omitted.length !== fields.length ||
      keys.length !== fields.length ||
      values.length !== config.values.length
    )
      throw new Error("Pivot grouping changed shape");
    const rowPath = keys
      .slice(0, config.rows.length)
      .filter((_, index) => !omitted[index]);
    const columnPath = keys
      .slice(config.rows.length)
      .filter((_, index) => !omitted[index + config.rows.length]);
    const row = {
      path: rowPath,
      rolledUp: config.rows.length - rowPath.length,
    };
    const column = {
      path: columnPath,
      rolledUp: config.columns.length - columnPath.length,
    };
    rowKeys.set(axisKey(row), row);
    columnKeys.set(axisKey(column), column);
    const filters = fields.flatMap((field, index) => {
      const value = keys[index];
      if (value === undefined)
        throw new Error("Pivot selection lost its field");
      return omitted[index] ? [] : [eqFilter(field, value)];
    });
    grid.set(digest([axisKey(row), axisKey(column)]), {
      values,
      selectionId: selection(selections, filters),
    });
  }
  function compare(a: Axis, b: Axis) {
    if (!a.path.length || !b.path.length)
      return Number(!a.path.length) - Number(!b.path.length);
    for (
      let index = 0;
      index < Math.min(a.path.length, b.path.length);
      index++
    ) {
      const left = a.path[index];
      const right = b.path[index];
      if (left === right) continue;
      if (left === null) return -1;
      if (right === null) return 1;
      if (typeof left === "number" && typeof right === "number")
        return left - right;
      return String(left).localeCompare(String(right), "en", { numeric: true });
    }
    return b.path.length - a.path.length;
  }
  rowPage = Math.min(rowPage, Math.max(1, Math.ceil(rowKeys.size / 50)));
  columnPage = Math.min(
    columnPage,
    Math.max(1, Math.ceil(columnKeys.size / 100)),
  );
  const rowWindow = [...rowKeys.values()]
    .sort(compare)
    .slice((rowPage - 1) * 50, rowPage * 50);
  const columnWindow = [...columnKeys.values()]
    .sort(compare)
    .slice((columnPage - 1) * 100, columnPage * 100);
  const result: PivotTransformResult = {
    status: raw.length ? "ready" : "empty",
    source: transformSource(producer),
    config,
    orientation: config.orientation,
    rowAxisCount: rowKeys.size,
    columnAxisCount: columnKeys.size,
    rowPage,
    columnPage,
    visualizationResultId,
    capped: raw.length > VISUALIZATION_GROUP_LIMIT,
    columnSubtotals: columnWindow.flatMap((key, index) =>
      key.path.length && key.rolledUp ? [index] : [],
    ),
    columns: columnWindow.map(axisValue),
    rows: rowWindow.map((row) => ({
      key: axisValue(row),
      subtotal: Boolean(row.path.length && row.rolledUp),
      values: columnWindow.flatMap((column) => {
        const group = grid.get(digest([axisKey(row), axisKey(column)]));
        return config.values.map((_, index) => {
          if (!group) return { kind: "missing" as const };
          const value = group.values[index];
          if (value === undefined)
            throw new Error("Pivot measure was not returned");
          return {
            kind: "value" as const,
            value,
            selectionId: group.selectionId,
          };
        });
      }),
    })),
  };
  return { result, selections };
}

async function metricView(
  producer: VisualizationProducer,
  config: MetricConfig,
): Promise<ComputedView | VisualizationFailure> {
  const field =
    config.fieldId === null
      ? producer.fields.at(0)
      : producer.fields.find(({ fieldId }) => fieldId === config.fieldId);
  if (!field) return config.fieldId === null ? unconfigured : invalid;
  const aggregation =
    config.mode === "row"
      ? null
      : (config.aggregation ?? defaultMetricAggregation(field));
  if (aggregation !== null && !metricAggregations(field).includes(aggregation))
    return invalid;
  if (config.mode === "row" && field.type === "string") return invalid;
  const value = await runLocalMetricTransform(
    producer.manifest,
    producer.fields,
    producer.stream,
    field.fieldId,
    aggregation,
    config.row,
  );
  const result: MetricTransformResult = {
    status: value === null ? "empty" : "ready",
    kind: "metric",
    source: transformSource(producer),
    field,
    aggregation,
    value,
  };
  return { result, selections: {} };
}

async function readCache(row: typeof visualizationResults.$inferSelect) {
  const { data } = await readPrivateBlob(row.artifact);
  return cacheSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)),
  );
}

function isCacheStorageUnconfigured(error: unknown) {
  return (
    (isPrivateBlobError(error) && error.kind === "not_configured") ||
    (isActionContractError(error) &&
      error.errorCode === "builder_oauth_reauthorization_required")
  );
}

async function saveCache(
  actor: ExecutionActor,
  view: VisualizationCell,
  producer: VisualizationProducer,
  id: string,
  computed: ComputedView,
) {
  let artifact: Awaited<ReturnType<typeof putPrivateBlob>>;
  let unconfiguredReason: string | null = null;
  try {
    artifact = await putPrivateBlob({
      ownerEmail: actor.ownerEmail,
      key: `notebook-visualizations/${id}/${randomUUID()}`,
      data: Buffer.from(JSON.stringify(computed)),
      mimeType: "application/json",
      metadata: { purpose: notebookResultBlobPurpose },
    });
  } catch (error) {
    if (!isCacheStorageUnconfigured(error)) throw error;
    artifact = null;
    unconfiguredReason = error instanceof Error ? error.message : String(error);
  }
  if (!artifact) {
    await assertCurrentSource(actor, view, producer);
    console.warn(
      "[notebook-transforms] visualization cache storage unavailable; returning uncached result",
      {
        projectId: view.target.projectId,
        cellId: view.target.cellId,
        versionId: view.versionId,
        reason: unconfiguredReason ?? "no_private_blob_provider",
      },
    );
    return;
  }
  const db = getDb();
  let obsolete: typeof artifact | undefined;
  let retained = false;
  try {
    await assertCurrentSource(actor, view, producer);
    const now = Date.now();
    const inserted = await db
      .insert(visualizationResults)
      .values({
        id,
        orgId: actor.orgId,
        configDigest: view.configDigest,
        projectId: view.target.projectId,
        versionId: view.versionId,
        cellId: view.target.cellId,
        sourceResultId: producer.manifest.result.resultId,
        expiresAt: now + resultTtl,
        artifact,
      })
      .onConflictDoNothing()
      .returning({ id: visualizationResults.id });
    if (inserted.length) {
      retained = true;
      return;
    }
    obsolete = await db.transaction(async (tx) => {
      const [expired] = await tx
        .select()
        .from(visualizationResults)
        .where(
          and(
            eq(visualizationResults.id, id),
            lte(visualizationResults.expiresAt, now),
          ),
        )
        .limit(1)
        .for("update");
      if (!expired) return undefined;
      await tx
        .update(visualizationResults)
        .set({ artifact, expiresAt: now + resultTtl })
        .where(eq(visualizationResults.id, id));
      return expired.artifact;
    });
    retained = obsolete !== undefined;
  } finally {
    const unused = retained ? obsolete : artifact;
    if (unused && !(await deletePrivateBlob(unused)).deleted)
      throw new Error("Unclaimed visualization storage could not be removed");
  }
}

function handleTransformError(error: unknown) {
  if (error instanceof VisualizationSourceChanged) return error.failure;
  if (error instanceof VisualizationBindingError) return invalid;
  if (error instanceof VisualizationResultLimit)
    return { status: "blocked", reason: "result_limit" } as const;
  console.error("[notebook-transforms] transform failed", error);
  return unreadable;
}

export async function getNotebookTransform(
  input: {
    projectId: string;
    cellId: string;
    releaseId?: string | undefined;
    sessionId?: string | undefined;
    previewId?: string | undefined;
    expectedConfigRevision?: number | undefined;
    expectedVersionId?: string | undefined;
    rowPage?: number | undefined;
    columnPage?: number | undefined;
    mode?: "chart" | "pivot" | "metric" | undefined;
  },
  caller = "frontend",
): Promise<NotebookTransform> {
  const actor = await currentResultActor(caller);
  let availableSources: NotebookTransform["sources"] = [];
  try {
    const view = await readVisualizationCell(actor, input);
    if ("status" in view) return { sources: [], result: view };
    const { contents } = view;
    if (
      (contents.kind !== "chart" &&
        contents.kind !== "pivot" &&
        contents.kind !== "metric") ||
      (input.mode && input.mode !== contents.kind)
    )
      return { sources: [], result: invalid };
    const configRevision =
      contents.kind === "chart"
        ? contents.chartSpec.revision
        : contents.kind === "pivot"
          ? contents.pivotConfig?.revision
          : contents.metricConfig?.revision;
    if (
      (input.expectedVersionId && input.expectedVersionId !== view.versionId) ||
      (input.expectedConfigRevision !== undefined &&
        input.expectedConfigRevision !== (configRevision ?? 0))
    )
      return { sources: [], result: conflict };
    const { resolved, sources } = await resolveVisualizationProducer(
      actor,
      view,
      bindingFor(view),
    );
    availableSources = sources;
    if (!("manifest" in resolved)) return { sources, result: resolved };
    const rowPage = input.rowPage ?? 1;
    const columnPage = input.columnPage ?? 1;
    const id = digest([
      actor.orgId,
      view.versionId,
      input.cellId,
      view.configDigest,
      resolved.manifest.result.resultId,
      rowPage,
      columnPage,
      ...(contents.kind === "metric"
        ? [input.releaseId, input.sessionId, input.previewId]
        : []),
    ]);
    const [existing] = await getDb()
      .select()
      .from(visualizationResults)
      .where(
        and(
          eq(visualizationResults.id, id),
          gt(visualizationResults.expiresAt, Date.now()),
        ),
      )
      .limit(1);
    if (existing) {
      const { result } = await readCache(existing);
      if (contents.kind === "metric")
        await assertCurrentSource(actor, view, resolved);
      return { sources, result };
    }
    if (contents.kind === "metric") {
      if (!contents.metricConfig) return { sources, result: unconfigured };
      const metric = await metricView(resolved, contents.metricConfig);
      if ("status" in metric) return { sources, result: metric };
      await saveCache(actor, view, resolved, id, metric);
      return { sources, result: metric.result };
    }
    const config =
      contents.kind === "chart"
        ? migrateChartSpec(
            contents.chartSpec,
            resolved.option.binding,
            resolved.fields,
          )
        : materializePivot(
            contents.pivotConfig ?? defaultPivotConfig,
            resolved,
          );
    if (!config) return { sources, result: invalid };
    if (
      "mark" in config
        ? !config.xField ||
          (!config.yField && !config.yFields?.length && !config.countRecords)
        : !config.values.length
    )
      return { sources, result: unconfigured };
    const computed =
      "mark" in config
        ? await chartView(actor, view, resolved, config, id)
        : await pivotView(
            actor,
            view,
            resolved,
            config,
            id,
            rowPage,
            columnPage,
          );
    await saveCache(actor, view, resolved, id, computed);
    return { sources, result: computed.result };
  } catch (error) {
    return { sources: availableSources, result: handleTransformError(error) };
  }
}

const pagePayload = z.tuple([
  z.int().nonnegative(),
  z.int().positive(),
  z.array(z.union([z.number(), z.string(), z.null()])),
  z.array(scalarList).max(50),
]);
function pageData(raw: unknown[], columns: ResultField[]) {
  if (raw.length !== 1)
    throw new Error("Visualization page metadata is missing");
  const [totalRows, page, totals, rows] = pagePayload.parse(raw[0]);
  if (rows.some((row) => row.length !== columns.length))
    throw new Error("Visualization page changed shape");
  return {
    status: totalRows ? ("ready" as const) : ("empty" as const),
    columns,
    totalRows,
    page,
    rows,
    totals,
  };
}

export async function getNotebookVisualizationPage(
  input: VisualizationPageInput,
  caller: string,
): Promise<VisualizationPageOutput> {
  const actor = await currentResultActor(caller);
  try {
    const view = await readVisualizationCell(actor, input);
    if ("status" in view) return { sources: [], ...view };
    if (view.contents.kind !== "display-table")
      return { sources: [], ...invalid };
    if (input.expectedUpdatedAt && input.expectedUpdatedAt !== view.updatedAt)
      return { sources: [], ...conflict };
    const { resolved, sources } = await resolveVisualizationProducer(
      actor,
      view,
      bindingFor(view),
    );
    if (!("manifest" in resolved)) return { sources, ...resolved };
    const resultId = resolved.manifest.result.resultId;
    if (input.resultId && input.resultId !== resultId)
      return { sources, ...stale };
    const config = view.contents.tableConfig;
    if (!config) return { sources, ...unconfigured };
    const page = input.page ?? 1;
    const sql = visualizationSql(resolved.fields).table(
      config.filters,
      config.sort,
      config.totals,
      page,
    );
    return {
      sources,
      resultId,
      ...pageData(
        await query(actor, view, resolved, sql, () =>
          runLocalTablePageTransform(
            resolved.manifest,
            resolved.fields,
            resolved.stream,
            {
              filters: config.filters,
              sort: config.sort,
              totals: config.totals,
              page,
            },
          ),
        ),
        resolved.fields,
      ),
    };
  } catch (error) {
    return { sources: [], ...handleTransformError(error) };
  }
}

export async function openNotebookVisualizationDrill(
  input: VisualizationDrillInput,
  caller: string,
): Promise<VisualizationDrillOutput> {
  const actor = await currentResultActor(caller);
  const view = await readVisualizationCell(actor, input);
  if ("status" in view) return view;
  const db = getDb();
  const [saved] = await db
    .select()
    .from(visualizationResults)
    .where(
      and(
        eq(visualizationResults.id, input.visualizationResultId),
        eq(visualizationResults.orgId, actor.orgId),
        eq(visualizationResults.projectId, input.projectId),
        eq(visualizationResults.versionId, view.versionId),
        eq(visualizationResults.cellId, input.cellId),
        gt(visualizationResults.expiresAt, Date.now()),
      ),
    )
    .limit(1);
  if (!saved || saved.configDigest !== view.configDigest) return stale;
  const { resolved } = await resolveVisualizationProducer(
    actor,
    view,
    bindingFor(view),
    false,
  );
  if (!("manifest" in resolved)) return resolved;
  if (saved.sourceResultId !== resolved.manifest.result.resultId) return stale;
  if (
    (input.releaseId || input.previewId) &&
    (input.mode === "keep" || input.mode === "remove")
  )
    return denied;
  const { result, selections } = await readCache(saved);
  const selected = selections[input.selectionId];
  if (!Object.hasOwn(selections, input.selectionId) || !selected)
    fail("This selection is no longer available.", {
      statusCode: 422,
      errorCode: "visualization_selection_invalid",
    });

  const intent = digest([
    saved.id,
    input.selectionId,
    input.mode,
    input.nextFieldId,
  ]);
  const actorKey = digest([actor.orgId, actor.ownerEmail]);
  await db
    .insert(visualizationDrills)
    .values({
      actorKey,
      requestId: input.requestId,
      resultId: saved.id,
      intent,
      expiresAt: saved.expiresAt,
    })
    .onConflictDoNothing();
  const [receipt] = await db
    .select({ intent: visualizationDrills.intent })
    .from(visualizationDrills)
    .where(
      and(
        eq(visualizationDrills.actorKey, actorKey),
        eq(visualizationDrills.requestId, input.requestId),
      ),
    )
    .limit(1);
  if (!receipt || receipt.intent !== intent)
    fail("This request was already used for a different selection.", {
      statusCode: 409,
      errorCode: "request_id_reused",
    });

  const names = new Map(
    resolved.fields.map(({ fieldId, name }) => [String(fieldId), name]),
  );
  const filters = selected.map((filter) => ({
    name: names.get(filter.fieldId) ?? filter.fieldId,
    value: "value" in filter ? filter.value : null,
  }));
  const resultId = resolved.manifest.result.resultId;
  if (input.mode === "keep" || input.mode === "remove")
    return {
      status: "ready",
      resultId,
      columns: [],
      rows: [],
      totalRows: 0,
      page: 1,
      filters,
      predicate: selected,
    };

  try {
    const { contents } = view;
    const pivot = "config" in result ? result.config : undefined;
    const chart =
      contents.kind === "chart"
        ? migrateChartSpec(
            contents.chartSpec,
            resolved.option.binding,
            resolved.fields,
          )
        : undefined;
    const compiler = visualizationSql(resolved.fields);
    const page = input.page ?? 1;
    let columns = resolved.fields;
    let sql: string;
    let fallback: () => Promise<unknown[]>;
    if (input.mode === "drill-down") {
      const field = columns.find(
        ({ fieldId }) => fieldId === input.nextFieldId,
      );
      if (!field || (!pivot && !chart)) return invalid;
      if (pivot) {
        if ([...pivot.rows, ...pivot.columns].includes(field.fieldId))
          return invalid;
        columns = [
          field,
          ...pivot.values.map(({ measureId, fieldId, aggregation }) =>
            resultFieldSchema.parse({
              fieldId: measureId,
              name: `${aggregation} of ${names.get(fieldId)}`,
              type: "number",
              nullable: true,
            }),
          ),
        ];
        sql = compiler.pivot(pivot, selected, field.fieldId, page);
        fallback = () =>
          runLocalPivotTransform(
            resolved.manifest,
            resolved.fields,
            resolved.stream,
            pivot,
            {
              drillFilters: selected,
              drillField: field.fieldId,
              page,
            },
          );
      } else if (chart) {
        const drill = compiler.chartDrill(chart, selected, field.fieldId, page);
        columns = [field, ...drill.measures];
        sql = drill.source;
        fallback = () =>
          runLocalChartDrillTransform(
            resolved.manifest,
            resolved.fields,
            resolved.stream,
            chart,
            selected,
            field.fieldId,
            page,
          );
      } else {
        return invalid;
      }
    } else {
      const tableFilters = [
        ...(pivot?.filters ?? chart?.filters ?? []),
        ...selected,
      ];
      sql = compiler.table(tableFilters, null, {}, page, chart?.excludedMarks);
      fallback = () =>
        runLocalTablePageTransform(
          resolved.manifest,
          resolved.fields,
          resolved.stream,
          {
            filters: tableFilters,
            excluded: chart?.excludedMarks,
            sort: null,
            totals: {},
            page,
          },
        );
    }
    const { totals: _totals, ...data } = pageData(
      await query(actor, view, resolved, sql, fallback),
      columns,
    );
    return { ...data, resultId, filters };
  } catch (error) {
    return handleTransformError(error);
  }
}
