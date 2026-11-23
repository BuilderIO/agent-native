import { z } from "zod";

import { dbtSemanticGrainSchema } from "../../../shared/dbt-semantic-metrics.js";
import { metricConfigSchema } from "../../../shared/metric-config.js";
import { pivotConfigSchema } from "../../../shared/pivot-config.js";
import type { projectDocumentWithLayoutSchema } from "../../../shared/project-document.js";
import {
  tableVisualizationConfigSchema,
  tableFilterSchema,
} from "../../../shared/table-visualization-config.js";
import { warehouseTableProvenanceSchema } from "../../../shared/warehouse-table.js";
import { CELL_KINDS, PARAMETER_INPUT_TYPES } from "./cell-types.js";

/** Project titles preserve their full accepted length; longer input is rejected before a write. */
export const PROJECT_TITLE_MAX_LENGTH = 500;
/** The source limits a project description to this many characters. */
export const PROJECT_DESCRIPTION_MAX_LENGTH = 1000;

export class ProjectTitleTooLongError extends Error {
  readonly code = "project_title_too_long";
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "ProjectTitleTooLongError";
  }
}

/**
 * Stored shapes for a project, its cells and its collections.
 *
 * These are the contracts the stores validate against, so a value that came
 * out of the database and one that came from a request body are checked the
 * same way. Anything the UI derives (labels, references, menus) lives in the
 * sibling modules and is computed, never stored.
 */

export const cellKindSchema = z.enum(CELL_KINDS);
export const cellIdSchema = z.string().min(1);
export const projectIdSchema = z.string().min(1);

const orderSchema = z
  .string()
  .regex(/^[0-9a-z]+$/, "Order keys use digits and lower-case letters.")
  .refine((value) => !value.endsWith("0"), {
    message: "Order keys must leave room below them.",
  });

export const chartMarkSchema = z.enum([
  "line",
  "bar",
  "area",
  "scatter",
  "pie",
  "histogram",
  "combo",
  "heatmap",
  "gantt",
  "sankey",
  "funnel",
]);

export type ChartMark = z.infer<typeof chartMarkSchema>;

export const chartOrientationSchema = z.enum(["vertical", "horizontal"]);
export const chartStackModeSchema = z.enum(["grouped", "stacked", "normalize"]);

export const chartTimeUnitSchema = z.enum([
  "none",
  "year",
  "quarter",
  "month",
  "week",
  "day",
  "hour",
  "minute",
  "second",
]);
export const chartAggregationSchema = z.enum([
  "none",
  "sum",
  "count",
  "average",
  "min",
  "max",
  "distinct_count",
  "median",
  "stddev",
  "stddevpop",
  "variance",
  "variancepop",
]);

export const chartSpecSchema = z.object({
  version: z.union([z.literal(2), z.literal(3)]).optional(),
  revision: z.int().nonnegative().optional(),
  sourceCellId: cellIdSchema.nullable().optional(),
  sourceExportId: z.string().min(1).nullable().optional(),
  fieldLabels: z.record(z.string(), z.string()).optional(),
  autoBind: z.boolean().optional(),
  mark: chartMarkSchema,
  xField: z.string().nullable(),
  xTimeUnit: chartTimeUnitSchema.optional(),
  yField: z.string().nullable(),
  yAggregation: chartAggregationSchema.optional(),
  countRecords: z.boolean().optional(),
  yFields: z.array(z.string()).optional(),
  secondaryYField: z.string().nullable().optional(),
  endField: z.string().nullable().optional(),
  orientation: chartOrientationSchema.optional(),
  stackMode: chartStackModeSchema.optional(),
  binCount: z.number().int().min(2).max(100).optional(),
  stacked: z.boolean().optional(),
  colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).optional(),
  yFormatter: z.enum(["number", "percent"]).optional(),
  seriesLabels: z.record(z.string(), z.string()).optional(),
  seriesOrder: z.array(z.string()).optional(),
  legend: z.boolean().optional(),
  seriesField: z.string().nullable(),
  tooltipChannels: z.boolean().optional(),
  filters: z.array(tableFilterSchema).max(32).optional(),
  excludedMarks: z
    .array(z.array(tableFilterSchema).min(1).max(4))
    .max(32)
    .optional(),
  funnelOutcomes: z
    .object({
      completedKey: z.string().trim().min(1),
      leftKey: z.string().trim().min(1),
      skippedKey: z.string().trim().min(1).optional(),
      optionalKey: z.string().trim().min(1).optional(),
    })
    .optional(),
  title: z.string().nullable(),
});

export type ChartSpec = z.infer<typeof chartSpecSchema>;

export const aggregationSchema = z.enum([
  "count",
  "sum",
  "average",
  "median",
  "min",
  "max",
  "distinct_count",
]);

export type Aggregation = z.infer<typeof aggregationSchema>;

export const columnConfigSchema = z.object({
  name: z.string(),
  header: z.string().nullable(),
  /** Display formats are stored as one of a fixed set, never free text. */
  format: z
    .enum(["text", "number", "percent", "currency", "date", "datetime"])
    .nullable(),
  hidden: z.boolean(),
});

export type ColumnConfig = z.infer<typeof columnConfigSchema>;

const baseCell = {
  id: cellIdSchema,
  order: orderSchema,
  parentSectionId: cellIdSchema.nullable().optional(),
  /** A name the person typed. Falls back to a generated label when absent. */
  label: z.string().nullable(),
  description: z.string().max(10000).optional(),
  hidden: z.boolean(),
  /** Grid placement, used by layouts that place cells by coordinates. */
  gridX: z.number().int().nullable(),
  gridY: z.number().int().nullable(),
  gridWidth: z.number().int().nullable(),
  gridHeight: z.number().int().nullable(),
};

export const sqlCellContentsSchema = z.object({
  ...baseCell,
  kind: z.literal("sql"),
  source: z.string(),
  pendingEdit: z
    .object({
      id: z.string(),
      baseSource: z.string(),
      source: z.string(),
    })
    .optional(),
  dataConnectionId: z.string().nullable(),
  connectionMode: z.literal("dataframes").optional(),
  connectionSelectedAt: z.string().optional(),
  warehouseTable: warehouseTableProvenanceSchema.optional(),
  databaseSchema: z.string().nullable(),
  resultVariable: z.string().nullable(),
  outputResult: z.boolean(),
});

export const codeCellContentsSchema = z.object({
  ...baseCell,
  kind: z.literal("code"),
  language: z.enum(["python", "r"]),
  source: z.string(),
  resultVariable: z.string().nullable(),
  outputResult: z.boolean(),
});

export const markdownCellContentsSchema = z.object({
  ...baseCell,
  kind: z.literal("markdown"),
  markdown: z.string(),
});

export const textCellContentsSchema = z.object({
  ...baseCell,
  kind: z.literal("text"),
  text: z.string(),
});

export const chartCellContentsSchema = z.object({
  ...baseCell,
  kind: z.literal("chart"),
  drilldownSql: z.string().optional(),
  dataframe: z
    .string()
    .nullable()
    .describe(
      "Chart data binding: a SQL/code cell's resultVariable in this project with a table output, or a JSON-encoded nonempty array of records. Inline records must have exactly the same two fields: one string category and one finite JSON number, not a numeric string. Set chartSpec.xField to the category key and chartSpec.yField to the numeric key; named table bindings use their column names. For staged datasets, use query-staged-dataset to query or aggregate the complete chart rows first, then encode those rows as JSON here. A staged dataset ID is not a renderable binding. Null leaves the chart unconfigured.",
    ),
  chartSpec: chartSpecSchema,
});

export const displayTableCellContentsSchema = z.object({
  ...baseCell,
  kind: z.literal("display-table"),
  dataframe: z.string().nullable(),
  columns: z.array(columnConfigSchema),
  tableConfig: tableVisualizationConfigSchema.optional(),
});

export const metricCellContentsSchema = z.object({
  ...baseCell,
  kind: z.literal("metric"),
  metricConfig: metricConfigSchema.optional(),
  valueVariableName: z.string().nullable(),
  /** Row to read when the input is a single value rather than a dataframe. */
  valueRowIndex: z.number().int().nullable(),
  resultVariable: z.string().nullable(),
  outputResult: z.boolean(),
  format: z
    .enum(["number", "percent", "currency", "compact_number", "text"])
    .nullable(),
});

export const pivotCellContentsSchema = z.object({
  ...baseCell,
  kind: z.literal("pivot"),
  dataframe: z.string().nullable(),
  pivotConfig: pivotConfigSchema.optional(),
  rows: z.array(z.string()),
  columns: z.array(z.string()),
  values: z.array(
    z.object({
      field: z.string(),
      aggregation: aggregationSchema,
    }),
  ),
});

export const filterCellContentsSchema = z.object({
  ...baseCell,
  kind: z.literal("filter"),
  dataframe: z.string().nullable(),
  filters: z.array(
    z.object({
      field: z.string(),
      operator: z.enum([
        "is",
        "is_not",
        "contains",
        "greater_than",
        "less_than",
        "between",
        "is_null",
        "is_not_null",
      ]),
      value: z.string(),
    }),
  ),
});

export const writebackCellContentsSchema = z.object({
  ...baseCell,
  kind: z.literal("writeback"),
  dataframeName: z.string().nullable(),
  dataConnectionId: z.string().nullable(),
  targetTable: z.string().nullable(),
});

export const parameterCellContentsSchema = z.object({
  ...baseCell,
  kind: z.literal("input"),
  name: z.string(),
  inputType: z.enum(PARAMETER_INPUT_TYPES),
  /** The default value, stored in the input's own serialized form. */
  defaultValueString: z.string(),
  /**
   * The allowed values of a dropdown input, in the order the person entered
   * them. Empty for every other input type.
   */
  options: z.array(z.string().max(500)).max(200).optional(),
  optionValueType: z.enum(["string", "number"]).optional(),
  dynamicOptions: z
    .strictObject({
      producerCellId: z.string().min(1),
      valueFieldId: z.string().min(1),
      displayFieldId: z.string().min(1).optional(),
    })
    .optional(),
  optionLabels: z.record(z.string(), z.string().max(500)).optional(),
  rangeInputs: z
    .strictObject({
      start: z.string().min(1),
      end: z.string().min(1),
      initialDays: z.number().int().min(1).max(3660).optional(),
    })
    .refine(({ start, end }) => start !== end)
    .optional(),
  /**
   * Dropdown only: choices come from a column of an earlier query's result
   * variable instead of `options`. Absent for static dropdowns.
   */
  optionsSource: z
    .object({
      dataframe: z.string().min(1).max(200),
      valueColumn: z.string().min(1).max(500),
      labelColumn: z.string().min(1).max(500).nullable().optional(),
    })
    .describe(
      "Dropdown or multiselect only: read the choices from valueColumn of an earlier SQL/code cell's resultVariable (dataframe) instead of options; labelColumn is optional display text. The choices come from the saved result, so run that cell first. A truncated result is shown as incomplete.",
    )
    .optional(),
  /** Dropdown only: allow the value to be cleared. */
  optional: z.boolean().optional(),
  /** Text only: edit the value in a textarea so it can hold line breaks. */
  multiline: z.boolean().optional(),
  sliderOptions: z
    .object({
      min: z.number().finite(),
      max: z.number().finite(),
      step: z.number().finite(),
    })
    .refine(({ min, max }) => min <= max)
    .optional(),
});

export const mapCellContentsSchema = z.object({
  ...baseCell,
  kind: z.literal("map"),
  layers: z.array(
    z.object({
      type: z.enum(["dataset", "area", "text", "heatmap", "scatter"]),
      dataframeName: z.string().nullable(),
    }),
  ),
});

export const exploreCellContentsSchema = z.object({
  ...baseCell,
  kind: z.literal("explore"),
  visualizationType: z.enum(["chart", "pivot"]),
  input: z.string().nullable(),
});

export const componentImportCellContentsSchema = z.object({
  ...baseCell,
  kind: z.literal("component-import"),
  componentVersionId: z.string().nullable(),
  title: z.string().nullable(),
});

export const collapsibleCellContentsSchema = z.object({
  ...baseCell,
  kind: z.literal("collapsible"),
  title: z.string().nullable(),
  collapsed: z.boolean(),
  headingStyle: z.enum(["auto", "h1", "h2", "h3", "label"]).optional(),
});

export const dbtMetricCellContentsSchema = z.object({
  ...baseCell,
  kind: z.literal("dbt-metric"),
  dataConnectionId: z.string().nullable(),
  metrics: z.array(z.string().min(1).max(256)).max(100),
  selectedTimegrain: dbtSemanticGrainSchema.nullable(),
  selectedDimensions: z.array(z.string().min(1).max(256)).max(100),
  useRichDisplay: z.boolean(),
});

export const vegaChartCellContentsSchema = z.object({
  ...baseCell,
  kind: z.literal("vega-chart"),
  spec: z.record(z.string(), z.unknown()).nullable(),
});

export const cellGroupCellContentsSchema = z.object({
  ...baseCell,
  kind: z.literal("cell-group"),
  title: z.string().nullable(),
});

export const blockCellContentsSchema = z.object({
  ...baseCell,
  kind: z.literal("block"),
  collapsed: z.boolean(),
});

export const cellContentsSchema = z.discriminatedUnion("kind", [
  sqlCellContentsSchema,
  codeCellContentsSchema,
  markdownCellContentsSchema,
  textCellContentsSchema,
  chartCellContentsSchema,
  displayTableCellContentsSchema,
  metricCellContentsSchema,
  pivotCellContentsSchema,
  filterCellContentsSchema,
  writebackCellContentsSchema,
  parameterCellContentsSchema,
  mapCellContentsSchema,
  exploreCellContentsSchema,
  componentImportCellContentsSchema,
  collapsibleCellContentsSchema,
  dbtMetricCellContentsSchema,
  vegaChartCellContentsSchema,
  cellGroupCellContentsSchema,
  blockCellContentsSchema,
]);

export type CellContents = z.infer<typeof cellContentsSchema>;

export function withoutPendingCellEdit(contents: CellContents): CellContents {
  if (contents.kind !== "sql" || !contents.pendingEdit) return contents;
  const { pendingEdit: _pendingEdit, ...copy } = contents;
  return copy;
}
export type CellKindOf<T extends CellContents> = T["kind"];

/** A cell as it is stored and returned to the client. */
export const cellSchema = z.object({
  id: cellIdSchema,
  projectId: projectIdSchema,
  versionId: z.string().min(1),
  contents: cellContentsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Cell = z.infer<typeof cellSchema>;

export const projectLanguageSchema = z.enum(["python", "r"]);
export type ProjectLanguage = z.infer<typeof projectLanguageSchema>;

export const projectSchema = z.object({
  id: projectIdSchema,
  ownerEmail: z.string().min(1),
  title: z.string().max(PROJECT_TITLE_MAX_LENGTH),
  untitledOrdinal: z.number().int().positive().nullable().optional(),
  description: z.string(),
  language: projectLanguageSchema,
  statusId: z.string().nullable(),
  favorited: z.boolean(),
  allowEmbedding: z.boolean().optional(),
  trashedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  lastOpenedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Project = z.infer<typeof projectSchema>;

export const appViewsByDurationSchema = z.object({
  ALL_TIME: z.number().int().nonnegative(),
  ONE_WEEK: z.number().int().nonnegative(),
  TWO_WEEKS: z.number().int().nonnegative(),
  ONE_MONTH: z.number().int().nonnegative(),
});
export type AppViewsByDuration = z.infer<typeof appViewsByDurationSchema>;

export const projectListRowSchema = projectSchema.extend({
  ownerName: z.string().nullable().optional(),
  creatorEmail: z.string().nullable(),
  creatorName: z.string().nullable().optional(),
  lastPublishedAt: z.string().nullable(),
  yourAccess: z.enum(["owner", "manage", "edit", "read"]),
  sharedWith: z.object({
    workspace: z.boolean(),
    directCount: z.number().int().nonnegative(),
  }),
  appViews: z.number().int().nonnegative().nullable(),
  appViewsByDuration: appViewsByDurationSchema.nullable().optional(),
  appLastViewedAt: z.string().nullable(),
});
export type ProjectListRow = z.infer<typeof projectListRowSchema>;

/** A project with the cells and version the editor renders. */
export const projectDocumentSchema = projectSchema.extend({
  workingVersionId: z.string().min(1),
  publishedVersionId: z.string().nullable(),
  cells: z.array(cellSchema),
  collectionIds: z.array(z.string()),
});

export type ProjectDocument = z.infer<typeof projectDocumentWithLayoutSchema>;

export const collectionSchema = z.object({
  id: z.string().min(1),
  ownerEmail: z.string().min(1),
  name: z.string(),
  description: z.string(),
  emoji: z.string().nullable(),
  kind: z.enum(["collection", "folder"]),
  parentId: z.string().nullable(),
  favorited: z.boolean(),
  trashedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Collection = z.infer<typeof collectionSchema>;

export const projectStatusSchema = z.object({
  id: z.string().min(1),
  ownerEmail: z.string().min(1),
  name: z.string(),
  description: z.string(),
  color: z.string().nullable(),
  endorsed: z.boolean(),
  inLibrary: z.boolean(),
  enforcesReview: z.boolean(),
  sortOrder: z.number().int(),
});

export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const runStatusSchema = z.enum([
  "queued",
  "running",
  "complete",
  "error",
  "cancelled",
]);

export type RunStatus = z.infer<typeof runStatusSchema>;

/**
 * A cell's output. Table results carry the columns and rows they produced;
 * the other shapes are keyed by `type` so a renderer can pick one branch.
 */
export const dataframeMaterializationSchema = z.object({
  version: z.literal(1),
  handle: z.object({
    id: z.string().min(1),
    provider: z.string().min(1),
    opaque: z.literal(true),
    encrypted: z.boolean(),
    mimeType: z.string().optional(),
    size: z.number().optional(),
    createdAt: z.string().optional(),
    metadata: z
      .record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
      )
      .optional(),
  }),
  snapshot: z.string().length(64),
  digest: z.string().length(64),
  dependencies: z
    .array(
      z.object({
        cellId: z.string(),
        generation: z.string(),
        connectionId: z.string().nullable(),
        snapshot: z.string().length(64),
      }),
    )
    .max(100),
});

export const tableOutputSchema = z.object({
  type: z.literal("table"),
  materialization: dataframeMaterializationSchema.optional(),
  materializationUnavailable: z
    .object({
      errorCode: z.enum([
        "project_dataframe_materialization_failed",
        "project_dataframe_storage_unavailable",
      ]),
      reason: z.string().min(1).max(500),
      snapshot: z.string().length(64),
    })
    .optional(),
  columns: z.array(
    z.object({
      name: z.string(),
      type: z.enum(["string", "number", "boolean", "date", "datetime", "null"]),
    }),
  ),
  rows: z.array(
    z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  ),
  rowCount: z.number().int(),
  truncated: z.boolean(),
  totalRows: z.string().regex(/^\d+$/).optional(),
});

export const metricOutputSchema = z.object({
  type: z.literal("metric"),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  formatted: z.string(),
});

export const chartOutputSchema = z.object({
  type: z.literal("chart"),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
});

export const textOutputSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const errorOutputSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
  detail: z.string().nullable(),
  code: z.enum(["cancel_unknown", "interrupted"]).optional(),
});

export const cellOutputSchema = z.discriminatedUnion("type", [
  tableOutputSchema,
  metricOutputSchema,
  chartOutputSchema,
  textOutputSchema,
  errorOutputSchema,
]);

export type CellOutput = z.infer<typeof cellOutputSchema>;

export const cellRunSchema = z.object({
  id: z.string().min(1),
  projectId: projectIdSchema,
  cellId: cellIdSchema,
  status: runStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  output: cellOutputSchema.nullable(),
});

export type CellRun = z.infer<typeof cellRunSchema>;

/**
 * Project titles are trimmed, and an untitled project keeps its placeholder.
 * An overlength title raises a typed validation error.
 */
export function normalizeProjectTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length > PROJECT_TITLE_MAX_LENGTH) {
    throw new ProjectTitleTooLongError(
      `Project names are limited to ${PROJECT_TITLE_MAX_LENGTH} characters.`,
    );
  }
  return trimmed;
}

export const UNTITLED_PROJECT_NAME = "Untitled project";

/**
 * A cell the caller is asking for, before the store assigns its id and its
 * place in the list. Sample data passes ids so its content is reproducible;
 * interactive creates leave them out and the store mints one.
 */
export type CellDraft = CellContents extends infer T
  ? T extends CellContents
    ? Omit<T, "id" | "order"> & { id?: string; order?: string }
    : never
  : never;
