import { createHash, randomUUID } from "node:crypto";

import {
  fail,
  isActionContractError,
  type ActionContractError,
} from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import { and, eq, inArray } from "@agent-native/core/db/schema";
import { getUserSetting, mutateUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  cellOutputSchema,
  cellContentsSchema,
  type Cell,
  type CellOutput,
  type CellContents,
  type ProjectDocument,
} from "../../app/lib/model/contracts.js";
import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../../shared/bigquery-source-contract.js";
import { capabilityScopeRefSchema } from "../../shared/capabilities.js";
import { PROJECT_QUERY_PAGE_SIZE } from "../../shared/project-query-page.js";
import { getDb, schema } from "../db/index.js";
import {
  ANALYTICS_CONTROL_IDS,
  requireCapability,
  requirePreparedDraftSqlCapability,
} from "../lib/analytics-capabilities.js";
import {
  assertGrantedDataConnection,
  assertValidCellConnection,
} from "../lib/project-action-access.js";
import { requireCurrentWorkspace } from "../lib/workspace-access.js";
import { updateCell } from "./cells-store.js";
import {
  WAREHOUSE_QUERY_MAX_TOTAL_PAGES,
  type WarehouseQueryInput,
} from "./data-connection-provider.js";
import {
  canReadConnectionResults,
  defaultDataConnectionId,
  cancelConnectionQuery,
  executeConnectionQuery,
} from "./data-connections.js";
import { isBuiltinSampleConnection } from "./data-connections.js";
import {
  assertSelectionAllowed,
  createInputChoiceResolver,
  typedSelection,
  type InputChoices,
} from "./input-options.js";
import { decodeJsonColumn, StoredDataError } from "./json-column.js";
import { assertEditableProject } from "./project-access.js";
import { getReadableProjectDocument } from "./projects-store.js";
import {
  CellOutputGenerationConflict,
  CellOutputGenerationUnavailable,
  lockCellOutputForEdit,
  lockCellOutputGeneration,
  readCellOutput,
  recordRun,
  reserveCellOutputGeneration,
  writeCellOutput,
} from "./runs-store.js";
import { executeSampleQuery, namesSampleTable } from "./sample-query.js";
import type { Queryable, WorkspaceScope } from "./scope.js";
import { seededSqlSource } from "./seed.js";
import {
  compileSqlTemplate,
  positionalParameterValues,
  hasSqlTemplate,
  type SqlTemplateValue,
} from "./sql-template.js";

const jobSchema = z.object({
  projectId: z.string(),
  jobId: z.string(),
  location: z.string().optional(),
});
const CANCEL_RESERVATION_TIMEOUT_MS = 120_000;
const stateSchema = z.object({
  requestId: z.string(),
  operation: z.string(),
  busy: z.boolean(),
  connectionId: z.string(),
  sourceHash: z.string(),
  startedAt: z.string(),
  status: z.enum([
    "running",
    "cancelling",
    "cancel_unknown",
    "cancelled",
    "complete",
    "error",
  ]),
  cancelRequested: z.boolean().optional(),
  cancelSent: z.boolean().optional(),
  cancelStartedAt: z.number().optional(),
  job: jobSchema.nullable(),
  pageToken: z.string().nullable(),
  totalRows: z.string().nullable(),
});
type QueryState = z.infer<typeof stateSchema>;
export const projectQueryStateSchema = z.object({
  status: z.enum([
    "running",
    "cancelling",
    "cancel_unknown",
    "cancelled",
    "complete",
    "error",
    "unavailable",
  ]),
  busy: z.boolean(),
  hasNextPage: z.boolean(),
  totalRows: z.string().nullable(),
  requestId: z.string(),
  canSeek: z.literal(true).optional(),
});
type QueryStateEntry =
  | readonly [string, z.infer<typeof projectQueryStateSchema>]
  | null;
export const queryResultSchema = z.object({
  status: z.enum(["running", "cancelling", "cancelled", "complete", "error"]),
  output: cellOutputSchema.nullable(),
  hasNextPage: z.boolean(),
  totalRows: z.string().nullable(),
});

const PUBLISHED_RESULT_ROW_LIMIT = 10_000;

function queryInputCells(
  cells: { id: string; contents: CellContents }[],
  source: string,
) {
  if (!hasSqlTemplate(source)) return [];
  return cells
    .flatMap(({ id, contents }) =>
      contents.kind === "input" ? [{ id, contents }] : [],
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

function querySourceHash(
  source: string,
  cells: { id: string; contents: CellContents }[],
) {
  return createHash("sha256")
    .update(source)
    .update(
      hasSqlTemplate(source)
        ? JSON.stringify(queryInputCells(cells, source))
        : "",
    )
    .digest("hex");
}

export async function settledWarehouseOutputGeneration(
  scope: WorkspaceScope,
  cell: Cell,
  cells: Cell[],
): Promise<string | null | undefined> {
  if (cell.contents.kind !== "sql") return undefined;
  const connectionId = cell.contents.dataConnectionId;
  if (!connectionId || isBuiltinSampleConnection(connectionId))
    return undefined;
  const raw = await getUserSetting(
    scope.ownerEmail,
    `analytics-2:query:${scope.orgId}:${cell.projectId}:${cell.id}`,
    { bypassCache: true, transaction: getDbExec() },
  );
  if (raw === null) return null;
  const state = stateSchema.parse(raw);
  if (
    state.busy ||
    (state.status !== "complete" && state.status !== "error") ||
    state.connectionId !== connectionId ||
    state.sourceHash !== querySourceHash(cell.contents.source, cells)
  )
    return null;
  return state.requestId;
}

function readableWarehouseFailure(error: unknown): string | null {
  if (
    !isActionContractError(error) ||
    error.errorCode !== "organization_query_provider_failed"
  )
    return null;
  const diagnostics = z
    .object({
      providerStatus: z.number().nullable(),
      providerReason: z.string().nullable(),
    })
    .safeParse(error.details);
  if (!diagnostics.success) return null;
  const { providerStatus, providerReason } = diagnostics.data;
  if (
    providerStatus === 401 ||
    providerStatus === 403 ||
    providerReason === "accessDenied"
  )
    return "Access to this query result was denied. Check the selected connection's permissions.";
  if (providerReason === "invalidQuery")
    return "BigQuery rejected the SQL. Check the query for invalid identifiers or syntax errors.";
  if (providerReason === "notFound")
    return "BigQuery could not find the table or dataset referenced by this query.";
  if (providerReason === "bytesBilledLimitExceeded")
    return "BigQuery exceeded the maximum bytes-billed limit for this query. Narrow the query or filter by a partitioned column.";
  if (providerReason === "responseTooLarge")
    return "BigQuery result exceeded the maximum response size. Add a LIMIT or aggregate the query.";
  return null;
}

function changed(): never {
  fail(
    "The query changed or another request is still running. Reload this project before continuing.",
    {
      statusCode: 409,
      errorCode: "project_query_changed",
    },
  );
}

function tableValue(
  value: unknown,
  type: string,
): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && /^(?:INT64|INTEGER)$/i.test(type)) {
    const number = Number(value);
    if (/^-?\d+$/.test(value) && Number.isSafeInteger(number)) return number;
  }
  if (typeof value === "string" && /^(?:FLOAT64|FLOAT)$/i.test(type)) {
    const number = Number(value);
    if (value.trim() && Number.isFinite(number)) return number;
  }
  if (typeof value === "string" && /^BOOL(?:EAN)?$/i.test(type)) {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  if (["string", "number", "boolean"].includes(typeof value))
    return value as string | number | boolean;
  return JSON.stringify(value);
}

function publishedTableValue(
  value: unknown,
  type: string,
): string | number | boolean | null {
  if (value == null) return null;
  if (/FLOAT|INT|NUMERIC/i.test(type)) {
    const number = Number(value);
    if (
      !Number.isFinite(number) ||
      (/INT/i.test(type) && !Number.isSafeInteger(number))
    )
      fail("A numeric query result cannot be represented safely.", {
        statusCode: 502,
        errorCode: "warehouse_query_value_unreadable",
      });
    return number;
  }
  if (
    /BOOL/i.test(type) &&
    typeof value === "string" &&
    value !== "true" &&
    value !== "false"
  )
    fail("A boolean query result is unreadable.", {
      statusCode: 502,
      errorCode: "warehouse_query_value_unreadable",
    });
  return tableValue(value, type);
}

function warehouseTableOutput(
  result: Awaited<ReturnType<typeof executeConnectionQuery>>,
  priorRows: Extract<CellOutput, { type: "table" }>["rows"] = [],
  toValue = tableValue,
): Extract<CellOutput, { type: "table" }> {
  const rows = [
    ...priorRows,
    ...result.rows.map((row) =>
      row.map((value, index) =>
        toValue(value, result.columns[index]?.type ?? ""),
      ),
    ),
  ];
  return {
    type: "table",
    columns: result.columns.map((column) => ({
      name: column.name,
      type: /BOOL/i.test(column.type)
        ? "boolean"
        : /TIMESTAMP|DATETIME/i.test(column.type)
          ? "datetime"
          : /DATE/i.test(column.type)
            ? "date"
            : /^(?:INT64|INTEGER|FLOAT64|FLOAT|NUMERIC|BIGNUMERIC|DECIMAL|BIGDECIMAL)$/i.test(
                  column.type,
                )
              ? "number"
              : "string",
    })),
    rows,
    rowCount: rows.length,
    truncated: result.hasNextPage,
    ...(result.hasNextPage && result.totalRows && /^\d+$/.test(result.totalRows)
      ? { totalRows: result.totalRows }
      : {}),
  };
}

function resolveProjectQuerySource(
  contents: Extract<CellContents, { kind: "sql" }>,
) {
  assertValidCellConnection(contents);
  if (contents.connectionMode === "dataframes")
    return { kind: "dataframes" } as const;
  const { dataConnectionId } = contents;
  const builtin = isBuiltinSampleConnection(dataConnectionId);
  if (dataConnectionId && !builtin)
    return { kind: "warehouse", dataConnectionId } as const;
  return { kind: "sample", builtin } as const;
}

type ProjectQuerySource = ReturnType<typeof resolveProjectQuerySource>;
type CompiledQuery = ReturnType<typeof compileSqlTemplate>;

function invalidInput(): never {
  fail("Invalid input value.", {
    statusCode: 422,
    errorCode: "project_input_invalid",
  });
}

function savedSelection(contents: {
  inputType: string;
  defaultValueString: string;
}): string[] {
  if (contents.inputType !== "MULTISELECT")
    return [contents.defaultValueString];
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents.defaultValueString || "[]");
  } catch {
    invalidInput();
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.every((value): value is string => typeof value === "string")
  )
    invalidInput();
  return parsed;
}

function compileProjectQuery(
  source: string,
  querySource: ProjectQuerySource,
  inputCells: ReturnType<typeof queryInputCells>,
  viewerValues?: Record<string, string | string[]>,
  point?: { x: string; series: string },
  queryChoices?: ReadonlyMap<string, InputChoices>,
): CompiledQuery {
  const values: Record<string, SqlTemplateValue> = Object.create(null);
  for (const {
    contents: { name, inputType, defaultValueString, options },
  } of inputCells) {
    if (Object.hasOwn(values, name)) invalidInput();
    let value =
      viewerValues && Object.hasOwn(viewerValues, name)
        ? (viewerValues[name] ?? defaultValueString)
        : defaultValueString;
    if (inputType === "MULTISELECT") {
      if (typeof value === "string") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(value || "[]");
        } catch {
          invalidInput();
        }
        if (
          !Array.isArray(parsed) ||
          !parsed.every((item) => typeof item === "string")
        )
          invalidInput();
        value = parsed;
      }
    } else if (Array.isArray(value)) invalidInput();
    let bound: SqlTemplateValue = value;
    const selected = Array.isArray(value) ? value : [value];
    const choices = queryChoices?.get(name);
    if (
      viewerValues &&
      (inputType === "DROPDOWN" || inputType === "MULTISELECT")
    ) {
      if (choices) assertSelectionAllowed(selected, choices);
      else if (selected.some((item) => item !== "" && !options?.includes(item)))
        invalidInput();
    }
    if (choices) {
      const typed = typedSelection(selected, choices);
      bound = Array.isArray(value) ? typed : (typed[0] ?? "");
    }
    values[name] = bound;
  }
  if (point) {
    values.drillX = point.x;
    values.drillSeries = point.series;
  }
  try {
    return compileSqlTemplate(
      source,
      values,
      {},
      { unquotedValues: true, positional: querySource.kind !== "warehouse" },
    );
  } catch {
    invalidInput();
  }
}

async function runProjectSampleQuery(
  source: string,
  builtin: boolean,
  compiled: CompiledQuery,
) {
  const result = await executeSampleQuery(
    compiled.sql,
    positionalParameterValues(compiled.parameters),
    builtin,
  );
  if (result) return result;
  if (!builtin && !namesSampleTable(source))
    fail("Select a data connection before running this query.", {
      statusCode: 422,
      errorCode: "project_connection_required",
    });
  fail(
    "This query uses the bundled sample data, which could not execute this SQL. Check the query or connect a data source.",
    {
      statusCode: 422,
      errorCode: "project_sample_query_unsupported",
    },
  );
}

function executeProjectWarehousePage(
  connectionId: string,
  scope: Parameters<typeof executeConnectionQuery>[1],
  input:
    | { compiled: CompiledQuery; requestId?: string }
    | Pick<WarehouseQueryInput, "job" | "pageToken" | "rowOffset" | "first">,
) {
  return executeConnectionQuery(
    {
      connectionId,
      first: 1000,
      ...("compiled" in input
        ? {
            query: input.compiled.sql,
            ...(input.compiled.parameters.length
              ? { parameters: input.compiled.parameters }
              : {}),
            ...(input.requestId ? { requestId: input.requestId } : {}),
          }
        : input),
    },
    scope,
  );
}

export async function runPublishedProjectQuery({
  project,
  versionId,
  cellId,
  contents,
  source,
  scope,
  caller,
  values,
  point,
  chartCellId,
}: {
  project: ProjectDocument;
  versionId: string;
  cellId: string;
  contents: Extract<CellContents, { kind: "sql" }>;
  source: string;
  scope: WorkspaceScope;
  caller: string;
  values: Record<string, string | string[]>;
  point: { x: string; series: string } | undefined;
  chartCellId?: string;
}): Promise<CellOutput> {
  const querySource = resolveProjectQuerySource(contents);
  if (querySource.kind === "dataframes") {
    const { runPublishedDataframe } = await import("./dataframe-execution.js");
    return runPublishedDataframe(
      { ...scope, caller },
      {
        projectId: project.id,
        versionId,
        cellId,
        values,
        ...(point && chartCellId ? { drill: { ...point, chartCellId } } : {}),
      },
    );
  }
  if (
    querySource.kind === "warehouse" &&
    !(await canReadConnectionResults(querySource.dataConnectionId))
  )
    fail("This connection is not available to you.", {
      statusCode: 403,
      errorCode: "data_connection_forbidden",
    });
  const inputCells = queryInputCells(project.cells, source);
  const choicesFor = createInputChoiceResolver({
    scope,
    projectId: project.id,
    outputVersionId: versionId,
    cells: project.cells,
    caller,
  });
  const queryChoices = new Map<string, InputChoices>();
  for (const { contents } of inputCells)
    if (contents.optionsSource != null)
      queryChoices.set(contents.name, await choicesFor(contents));
  const compiled = compileProjectQuery(
    source,
    querySource,
    inputCells,
    values,
    point,
    queryChoices,
  );
  if (querySource.kind === "sample")
    return (await runProjectSampleQuery(source, querySource.builtin, compiled))
      .output;
  const { dataConnectionId } = querySource;
  const queryScope = {
    userEmail: scope.ownerEmail,
    orgId: scope.orgId,
    caller,
  };
  let result = await executeProjectWarehousePage(dataConnectionId, queryScope, {
    compiled,
  });
  for (let i = 0; !result.jobComplete && i < 5; i++) {
    if (!result.jobReference)
      fail("The query did not return a job reference.", {
        statusCode: 502,
        errorCode: "warehouse_query_unreadable",
      });
    result = await executeProjectWarehousePage(dataConnectionId, queryScope, {
      job: result.jobReference,
    });
  }
  if (!result.jobComplete)
    fail("The query is still running. Please try again.", {
      statusCode: 504,
      errorCode: "warehouse_query_pending",
    });
  let rows: Extract<CellOutput, { type: "table" }>["rows"] = [];
  while (
    result.hasNextPage &&
    result.pageToken &&
    rows.length + result.rows.length < PUBLISHED_RESULT_ROW_LIMIT
  ) {
    if (!result.jobReference)
      fail("The query did not return a job reference.", {
        statusCode: 502,
        errorCode: "warehouse_query_unreadable",
      });
    rows = warehouseTableOutput(result, rows, publishedTableValue).rows;
    const pageToken: string = result.pageToken;
    result = await executeProjectWarehousePage(dataConnectionId, queryScope, {
      job: result.jobReference,
      pageToken,
      first: Math.min(1000, PUBLISHED_RESULT_ROW_LIMIT - rows.length),
    });
    if (!result.jobComplete || result.pageToken === pageToken)
      fail("The query result page is invalid.", {
        statusCode: 502,
        errorCode: "warehouse_query_page_invalid",
      });
  }
  return warehouseTableOutput(result, rows, publishedTableValue);
}

export async function runProjectQuery(
  input: {
    projectId: string;
    cellId: string;
    operation?: "run" | "poll" | "next-page" | "page" | undefined;
    requestId?: string | undefined;
    rowOffset?: number | undefined;
  },
  caller: string,
) {
  const current = await requireCurrentWorkspace();
  const scope = { ownerEmail: current.ownerEmail, orgId: current.orgId };
  const mode = input.operation ?? "run";
  await assertEditableProject(scope, input.projectId);
  const project = await getReadableProjectDocument(scope, input.projectId);
  const cell = project?.cells.find((item) => item.id === input.cellId);
  if (!project && mode === "run")
    await requireCapability(
      ANALYTICS_CONTROL_IDS.runDraftSql,
      capabilityScopeRefSchema.parse({
        kind: "cell",
        workspaceId: current.orgId,
        projectId: input.projectId,
        cellId: input.cellId,
      }),
    );
  if (!project || !cell || cell.contents.kind !== "sql") {
    fail("That SQL cell is not in this project.", {
      statusCode: 404,
      errorCode: "project_sql_cell_not_found",
    });
  }
  if (mode === "run") {
    const savedConnectionId = cell.contents.dataConnectionId;
    const dataframes = cell.contents.connectionMode === "dataframes";
    assertValidCellConnection(cell.contents);
    const selected = dataframes
      ? null
      : (savedConnectionId ??
        seededSqlSource(scope, cell) ??
        (await defaultDataConnectionId()));
    const setDefault = savedConnectionId === null && selected !== null;
    if (setDefault) await assertGrantedDataConnection(selected);
    if (
      dataframes ||
      selected !== null ||
      namesSampleTable(cell.contents.source)
    )
      await requirePreparedDraftSqlCapability(current, cell, selected);
    if (setDefault) {
      const updated = await updateCell({
        ...scope,
        projectId: input.projectId,
        versionId: project.workingVersionId,
        cellId: cell.id,
        contents: { ...cell.contents, dataConnectionId: selected },
        expectedUpdatedAt: cell.updatedAt,
      });
      if (updated === null || updated.contents.kind !== "sql") changed();
      cell.contents = updated.contents;
    }
  }
  const {
    source,
    dataConnectionId: savedConnectionId,
    connectionMode,
  } = cell.contents;
  const querySource = resolveProjectQuerySource(cell.contents);
  if (querySource.kind === "dataframes") {
    if (input.operation && input.operation !== "run") changed();
    const { runDraftDataframe } = await import("./dataframe-execution.js");
    const output = await runDraftDataframe({ ...scope, caller }, input);
    return queryResultSchema.parse({
      status: "complete",
      output,
      hasNextPage: false,
      totalRows: output.totalRows ?? String(output.rowCount),
    });
  }
  const hasTemplate = hasSqlTemplate(source);
  const inputCells = queryInputCells(project.cells, source);
  const inputSnapshot = JSON.stringify(inputCells);
  const dynamicInputs = hasTemplate
    ? inputCells.flatMap(({ contents }) =>
        contents.optionsSource != null &&
        (contents.inputType === "DROPDOWN" ||
          contents.inputType === "MULTISELECT")
          ? [contents]
          : [],
      )
    : [];
  const resolveDynamicChoices = async (
    cells: readonly { id: string; contents: CellContents }[],
  ) => {
    const choicesFor = createInputChoiceResolver({
      scope,
      projectId: input.projectId,
      cells,
      caller,
    });
    const resolved = new Map<string, InputChoices>();
    for (const { name } of dynamicInputs) {
      const now = cells.find(
        ({ contents }) => contents.kind === "input" && contents.name === name,
      );
      if (now?.contents.kind !== "input") changed();
      resolved.set(name, await choicesFor(now.contents));
    }
    return resolved;
  };
  if (mode === "run") {
    for (const { optionsSource } of dynamicInputs) {
      const sourceCell = project.cells.find(
        ({ contents }) =>
          contents.kind === "sql" &&
          contents.resultVariable === optionsSource?.dataframe,
      );
      if (sourceCell === undefined || sourceCell.id === input.cellId) continue;
      for (let page = 0; page < WAREHOUSE_QUERY_MAX_TOTAL_PAGES; page += 1) {
        const state = await getProjectQueryState(
          input.projectId,
          sourceCell.id,
        );
        if (state?.status !== "complete" || !state.hasNextPage) break;
        await runProjectQuery(
          {
            projectId: input.projectId,
            cellId: sourceCell.id,
            operation: "next-page",
          },
          caller,
        );
      }
    }
  }
  const dynamicChoices = await resolveDynamicChoices(project.cells);
  if (mode === "run") {
    for (const contents of dynamicInputs) {
      const choices = dynamicChoices.get(contents.name);
      if (choices === undefined) changed();
      assertSelectionAllowed(savedSelection(contents), choices);
    }
  }
  const assertSourceUnchanged = async () => {
    if (dynamicChoices.size === 0) return;
    const fresh = await getReadableProjectDocument(
      scope,
      input.projectId,
      project.workingVersionId,
    );
    if (!fresh) changed();
    const now = await resolveDynamicChoices(fresh.cells);
    for (const [name, before] of dynamicChoices)
      if (now.get(name)?.identity !== before.identity) changed();
  };
  const compileInputs = () =>
    compileProjectQuery(
      source,
      querySource,
      inputCells,
      undefined,
      undefined,
      dynamicChoices,
    );
  const assertSavedQuery = async (tx: Queryable) => {
    // Output generation is locked before the project, as in cell writes.
    const [lockedProject] = await tx
      .select({ workingVersionId: schema.projects.workingVersionId })
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.id, input.projectId),
          eq(schema.projects.orgId, scope.orgId),
        ),
      )
      .limit(1)
      .for("update");
    if (
      !lockedProject ||
      lockedProject.workingVersionId !== project.workingVersionId
    )
      changed();
    await assertEditableProject(scope, input.projectId, tx);
    await assertSourceUnchanged();
    if (hasTemplate) {
      const rows = await tx
        .select({ id: schema.cells.id, contents: schema.cells.contents })
        .from(schema.cells)
        .where(
          and(
            eq(schema.cells.projectId, input.projectId),
            eq(schema.cells.versionId, project.workingVersionId),
            eq(schema.cells.kind, "input"),
          ),
        )
        .limit(inputCells.length + 1);
      const currentInputs = rows
        .map((row) => {
          const contents = decodeJsonColumn(row.contents, cellContentsSchema);
          if (!contents || contents.kind !== "input")
            throw new StoredDataError(
              "Stored workspace data does not match the current schema. This record needs repair.",
            );
          return { id: row.id, contents };
        })
        .sort((a, b) => a.id.localeCompare(b.id));
      if (JSON.stringify(currentInputs) !== inputSnapshot) changed();
    }
    const [row] = await tx
      .select({ contents: schema.cells.contents })
      .from(schema.cells)
      .where(
        and(
          eq(schema.cells.projectId, input.projectId),
          eq(schema.cells.versionId, project.workingVersionId),
          eq(schema.cells.id, input.cellId),
        ),
      )
      .limit(1);
    const currentCell = row
      ? decodeJsonColumn(row.contents, cellContentsSchema)
      : null;
    if (
      currentCell?.kind !== "sql" ||
      currentCell.source !== source ||
      currentCell.dataConnectionId !== savedConnectionId ||
      currentCell.connectionMode !== connectionMode
    )
      changed();
  };
  // A new workspace has no warehouse yet, and its sample projects name the
  // bundled sample tables. Run those from sample data so the first thing a new
  // person clicks works; anything that is not a sample-table query still asks
  // for a connection.
  if (querySource.kind === "sample") {
    if (input.operation && input.operation !== "run") changed();
    const generation = randomUUID();
    await getDb().transaction(async (tx) => {
      await lockCellOutputForEdit(input.projectId, input.cellId, tx);
      await assertSavedQuery(tx);
      await reserveCellOutputGeneration(
        input.projectId,
        input.cellId,
        generation,
        tx,
      );
    });
    let sample:
      | Awaited<ReturnType<typeof runProjectSampleQuery>>
      | ActionContractError;
    try {
      sample = await runProjectSampleQuery(
        source,
        querySource.builtin,
        compileInputs(),
      );
    } catch (error) {
      if (
        !isActionContractError(error) ||
        ![
          "project_sample_query_timeout",
          "project_sample_query_busy",
          "project_sample_query_failed",
          "project_sample_query_unsupported",
          "project_connection_required",
          "project_input_invalid",
        ].includes(error.errorCode)
      )
        throw error;
      sample = error;
    }
    const result = sample;
    const failed = isActionContractError(result);
    try {
      await getDb().transaction(async (tx) => {
        await lockCellOutputForEdit(input.projectId, input.cellId, tx);
        await assertSavedQuery(tx);
        await writeCellOutput(
          {
            ...scope,
            projectId: input.projectId,
            cellId: input.cellId,
            generation,
            runId: generation,
            status: failed ? "error" : "complete",
            output: failed
              ? { type: "error", message: result.message, detail: null }
              : result.output,
            ranAt: new Date().toISOString(),
          },
          tx,
        );
      });
    } catch (error) {
      if (error instanceof CellOutputGenerationConflict) changed();
      throw error;
    }
    if (failed) throw result;
    return queryResultSchema.parse({
      status: "complete",
      output: result.output,
      hasNextPage: false,
      totalRows: result.output.truncated
        ? null
        : String(result.output.rowCount),
    });
  }
  const { dataConnectionId } = querySource;
  const sourceHash = querySourceHash(source, project.cells);
  const key = `analytics-2:query:${current.orgId}:${input.projectId}:${input.cellId}`;
  if (mode === "page") {
    const { requestId, rowOffset, projectId, cellId } = input;
    const state = stateSchema
      .nullable()
      .parse(
        await getUserSetting(current.ownerEmail, key, { bypassCache: true }),
      );
    if (
      !requestId ||
      !state?.job ||
      state.status !== "complete" ||
      state.requestId !== requestId ||
      state.sourceHash !== sourceHash ||
      state.connectionId !== dataConnectionId
    )
      changed();
    if (
      dataConnectionId === ORGANIZATION_BIGQUERY_SOURCE_ID ||
      !state.totalRows ||
      !/^\d+$/.test(state.totalRows) ||
      rowOffset === undefined ||
      !Number.isSafeInteger(rowOffset) ||
      rowOffset < 0 ||
      rowOffset > Number.MAX_SAFE_INTEGER - PROJECT_QUERY_PAGE_SIZE ||
      rowOffset % PROJECT_QUERY_PAGE_SIZE !== 0 ||
      BigInt(rowOffset) >= BigInt(state.totalRows)
    )
      fail("That query result page is unavailable.", {
        statusCode: 422,
        errorCode: "warehouse_query_page_invalid",
      });
    const checkCurrent = () =>
      getDb().transaction(async (tx) => {
        await lockCellOutputGeneration(projectId, cellId, requestId, tx);
        await assertSavedQuery(tx);
      });
    try {
      await checkCurrent();
      const remaining = BigInt(state.totalRows) - BigInt(rowOffset);
      const size = Number(
        remaining < BigInt(PROJECT_QUERY_PAGE_SIZE)
          ? remaining
          : BigInt(PROJECT_QUERY_PAGE_SIZE),
      );
      let output: ReturnType<typeof warehouseTableOutput> | undefined;
      while ((output?.rows.length ?? 0) < size) {
        const loaded = output?.rows.length ?? 0;
        const result = await executeProjectWarehousePage(
          dataConnectionId,
          { userEmail: current.ownerEmail, orgId: current.orgId, caller },
          {
            job: state.job,
            rowOffset: rowOffset + loaded,
            first: size - loaded,
          },
        );
        if (
          !result.jobComplete ||
          result.rows.length === 0 ||
          (!result.hasNextPage && loaded + result.rows.length !== size)
        )
          fail("The query result page could not be read completely.", {
            statusCode: 502,
            errorCode: "warehouse_query_incomplete",
          });
        output = warehouseTableOutput(result, output?.rows);
      }
      await checkCurrent();
      return queryResultSchema.parse({
        status: "complete",
        output,
        hasNextPage: BigInt(rowOffset) + BigInt(size) < BigInt(state.totalRows),
        totalRows: state.totalRows,
      });
    } catch (error) {
      if (
        error instanceof CellOutputGenerationConflict ||
        error instanceof CellOutputGenerationUnavailable
      )
        changed();
      throw error;
    }
  }
  const operation = randomUUID();
  const startedAt = new Date().toISOString();
  await getUserSetting(current.ownerEmail, key, { bypassCache: true });
  const reserved = await getDb().transaction(async (tx) => {
    const generationWasMissing = await lockCellOutputForEdit(
      input.projectId,
      input.cellId,
      tx,
    );
    const [currentGeneration] = await tx
      .select({ generation: schema.cellOutputGenerations.generation })
      .from(schema.cellOutputGenerations)
      .where(
        and(
          eq(schema.cellOutputGenerations.projectId, input.projectId),
          eq(schema.cellOutputGenerations.cellId, input.cellId),
        ),
      )
      .limit(1);
    if (!currentGeneration)
      throw new Error("Cell output generation is unavailable.");
    const state = stateSchema.parse(
      await mutateUserSetting(
        current.ownerEmail,
        key,
        (raw) => {
          const previous = raw === null ? null : stateSchema.parse(raw);
          const isCurrent =
            previous?.requestId === currentGeneration.generation;
          if (mode === "run") {
            if (input.requestId && previous?.requestId === input.requestId)
              changed();
            if (
              isCurrent &&
              (previous.busy ||
                ["running", "cancelling", "cancel_unknown"].includes(
                  previous.status,
                ))
            )
              changed();
            return {
              requestId: input.requestId ?? randomUUID(),
              operation,
              busy: true,
              connectionId: dataConnectionId,
              sourceHash,
              startedAt,
              status: "running",
              job: null,
              pageToken: null,
              totalRows: null,
            };
          }
          if (
            !previous ||
            (input.requestId !== undefined &&
              previous.requestId !== input.requestId) ||
            previous.sourceHash !== sourceHash ||
            previous.connectionId !== dataConnectionId ||
            !previous.job ||
            (mode === "poll" && previous.status !== "running") ||
            (mode === "next-page" &&
              (previous.status !== "complete" || !previous.pageToken))
          )
            changed();
          if (!isCurrent) {
            if (generationWasMissing)
              throw new CellOutputGenerationUnavailable();
            changed();
          }
          if (previous.busy) changed();
          return { ...previous, operation, busy: true };
        },
        { transaction: getDbExec() },
      ),
    );
    if (mode === "run")
      await reserveCellOutputGeneration(
        input.projectId,
        input.cellId,
        state.requestId,
        tx,
      );
    await assertSavedQuery(tx);
    return state;
  });
  const assertReservation = (
    raw: Record<string, unknown> | null,
  ): QueryState => {
    const state = stateSchema.parse(raw);
    if (
      state.operation !== operation ||
      state.requestId !== reserved.requestId ||
      !state.busy
    )
      changed();
    return state;
  };
  try {
    if (mode !== "run") {
      await getDb().transaction(async (tx) => {
        await lockCellOutputGeneration(
          input.projectId,
          input.cellId,
          reserved.requestId,
          tx,
        );
        await assertSavedQuery(tx);
      });
    }
    const compiled = compileInputs();
    const result = await executeProjectWarehousePage(
      dataConnectionId,
      { userEmail: current.ownerEmail, orgId: current.orgId, caller },
      mode === "run"
        ? { compiled, requestId: reserved.requestId }
        : {
            job: reserved.job ?? changed(),
            ...(mode === "next-page" && reserved.pageToken
              ? { pageToken: reserved.pageToken }
              : {}),
          },
    );
    const previousOutput =
      mode === "next-page"
        ? await readCellOutput(scope, input.projectId, input.cellId)
        : null;
    let output: CellOutput | null = null;
    if (result.jobComplete) {
      output = warehouseTableOutput(
        result,
        previousOutput?.output?.type === "table"
          ? previousOutput.output.rows
          : [],
      );
    }
    const next: QueryState = {
      ...reserved,
      busy: false,
      status: result.status,
      job: result.jobReference,
      pageToken: result.pageToken,
      totalRows: result.totalRows,
    };
    const committed = await getDb().transaction(async (tx) => {
      await lockCellOutputGeneration(
        input.projectId,
        input.cellId,
        reserved.requestId,
        tx,
      );
      await assertSavedQuery(tx);
      const state = stateSchema.parse(
        await mutateUserSetting(
          current.ownerEmail,
          key,
          (raw) => {
            const currentState = assertReservation(raw);
            return currentState.cancelRequested === true && !result.jobComplete
              ? { ...next, status: "cancelling", cancelRequested: true }
              : next;
          },
          { transaction: getDbExec() },
        ),
      );
      const shared = {
        ...scope,
        projectId: input.projectId,
        cellId: input.cellId,
        sourceConnectionId: dataConnectionId,
      };
      if (result.jobComplete && mode !== "next-page") {
        await recordRun(
          {
            ...shared,
            generation: reserved.requestId,
            status: "complete",
            output,
            startedAt: reserved.startedAt,
            finishedAt: new Date().toISOString(),
            durationMs: Date.now() - Date.parse(reserved.startedAt),
          },
          tx,
        );
      } else {
        await writeCellOutput(
          {
            ...shared,
            generation: reserved.requestId,
            runId: reserved.requestId,
            status: result.status,
            output,
            ranAt: new Date().toISOString(),
          },
          tx,
        );
      }
      return state;
    });
    return queryResultSchema.parse({
      status: committed.status,
      output,
      hasNextPage: result.hasNextPage,
      totalRows: result.totalRows,
    });
  } catch (error) {
    const providerMessage = readableWarehouseFailure(error);
    // A denied or stale operation is never retried through another transport.
    // Store a safe error without replacing the exception returned to the caller.
    try {
      await getDb().transaction(async (tx) => {
        await lockCellOutputGeneration(
          input.projectId,
          input.cellId,
          reserved.requestId,
          tx,
        );
        await assertSavedQuery(tx);
        const saved = stateSchema.parse(
          await mutateUserSetting(
            current.ownerEmail,
            key,
            (raw) => {
              const state = assertReservation(raw);
              return {
                ...state,
                busy: false,
                status:
                  state.cancelRequested && state.job
                    ? "cancelling"
                    : state.cancelRequested
                      ? "cancel_unknown"
                      : "error",
              };
            },
            { transaction: getDbExec() },
          ),
        );
        if (saved.status !== "cancelling")
          await writeCellOutput(
            {
              ...scope,
              projectId: input.projectId,
              cellId: input.cellId,
              sourceConnectionId: dataConnectionId,
              generation: reserved.requestId,
              runId: reserved.requestId,
              status: "error",
              output: {
                type: "error",
                ...(saved.status === "cancel_unknown"
                  ? { code: "cancel_unknown" as const }
                  : {}),
                message:
                  saved.status === "cancel_unknown"
                    ? "The query cancellation outcome is unknown."
                    : isActionContractError(error)
                      ? (providerMessage ?? error.message)
                      : "The query could not be completed.",
                detail: null,
              },
            },
            tx,
          );
      });
    } catch (publicationError) {
      if (
        !(publicationError instanceof CellOutputGenerationConflict) &&
        !(publicationError instanceof CellOutputGenerationUnavailable)
      )
        throw publicationError;
      await mutateUserSetting(current.ownerEmail, key, (raw) => {
        const state = stateSchema.parse(raw);
        if (
          state.operation !== operation ||
          state.requestId !== reserved.requestId ||
          !state.busy
        )
          return state;
        return { ...state, busy: false, status: "error" };
      });
      if (publicationError instanceof CellOutputGenerationConflict) changed();
      throw publicationError;
    }
    if (error instanceof CellOutputGenerationConflict) changed();
    if (providerMessage && isActionContractError(error))
      fail(providerMessage, {
        errorCode: error.errorCode,
        statusCode: error.statusCode,
        ...(error.details === undefined ? {} : { details: error.details }),
      });
    throw error;
  }
}

export async function cancelProjectQuery(
  input: {
    projectId: string;
    cellId: string;
    requestId: string;
    operation?: "status" | undefined;
  },
  caller: string,
) {
  const current = await requireCurrentWorkspace();
  const scope = { ownerEmail: current.ownerEmail, orgId: current.orgId };
  await assertEditableProject(scope, input.projectId);
  const project = await getReadableProjectDocument(scope, input.projectId);
  const cell = project?.cells.find((item) => item.id === input.cellId);
  if (
    !project ||
    !cell ||
    cell.contents.kind !== "sql" ||
    !cell.contents.dataConnectionId
  )
    fail("That SQL cell has no cancellable query.", {
      statusCode: 404,
      errorCode: "project_sql_cell_not_found",
    });
  const connectionId = cell.contents.dataConnectionId;
  const sourceHash = querySourceHash(cell.contents.source, project.cells);
  const key = `analytics-2:query:${current.orgId}:${input.projectId}:${input.cellId}`;
  const operationId = randomUUID();
  await getUserSetting(current.ownerEmail, key, { bypassCache: true });
  const reserved = await getDb().transaction(async (tx) => {
    await lockCellOutputForEdit(input.projectId, input.cellId, tx);
    const state = stateSchema.parse(
      await mutateUserSetting(
        current.ownerEmail,
        key,
        (raw) => {
          if (raw === null) changed();
          const state = stateSchema.parse(raw);
          if (
            state.requestId !== input.requestId ||
            state.connectionId !== connectionId ||
            state.sourceHash !== sourceHash ||
            !["running", "cancelling"].includes(state.status)
          )
            changed();
          if (
            state.busy &&
            state.cancelRequested &&
            state.cancelStartedAt !== undefined &&
            Date.now() - state.cancelStartedAt >= CANCEL_RESERVATION_TIMEOUT_MS
          )
            fail("The query cancellation outcome is unknown.", {
              errorCode: "project_query_cancel_unknown",
              statusCode: 409,
            });
          if (state.busy || !state.job)
            return {
              ...state,
              cancelRequested: true,
              cancelStartedAt: state.cancelStartedAt ?? Date.now(),
            };
          return {
            ...state,
            status: "cancelling",
            cancelRequested: true,
            cancelStartedAt: Date.now(),
            busy: true,
            operation: operationId,
          };
        },
        { transaction: getDbExec() },
      ),
    );
    await lockCellOutputGeneration(
      input.projectId,
      input.cellId,
      state.requestId,
      tx,
    );
    return state;
  });
  if (reserved.operation !== operationId || !reserved.job)
    return { status: "cancelling" as const };
  let result: Awaited<ReturnType<typeof cancelConnectionQuery>>;
  try {
    result = await cancelConnectionQuery(
      {
        connectionId,
        job: reserved.job,
        operation: reserved.cancelSent ? "status" : "request",
      },
      { userEmail: current.ownerEmail, orgId: current.orgId, caller },
    );
  } catch (error) {
    await mutateUserSetting(current.ownerEmail, key, (raw) => {
      const state = stateSchema.parse(raw);
      if (
        state.requestId !== reserved.requestId ||
        state.operation !== operationId
      )
        changed();
      return { ...state, busy: false, cancelSent: false };
    });
    throw error;
  }
  await getDb().transaction(async (tx) => {
    await lockCellOutputGeneration(
      input.projectId,
      input.cellId,
      reserved.requestId,
      tx,
    );
    await mutateUserSetting(
      current.ownerEmail,
      key,
      (raw) => {
        const state = stateSchema.parse(raw);
        if (
          state.requestId !== reserved.requestId ||
          state.operation !== operationId ||
          !state.busy
        )
          changed();
        return {
          ...state,
          busy: false,
          cancelSent: true,
          status:
            result === "pending"
              ? "cancelling"
              : result === "complete"
                ? "running"
                : result === "failed"
                  ? "error"
                  : "cancelled",
          cancelRequested: result === "pending",
        };
      },
      { transaction: getDbExec() },
    );
    if (result === "cancelled" || result === "failed")
      await recordRun(
        {
          ...scope,
          projectId: input.projectId,
          cellId: input.cellId,
          sourceConnectionId: connectionId,
          generation: reserved.requestId,
          status: result === "cancelled" ? "cancelled" : "error",
          output: {
            type: "error",
            ...(result === "cancelled" ? { code: "interrupted" as const } : {}),
            message:
              result === "cancelled"
                ? "Your query was interrupted"
                : "The query could not be completed.",
            detail: null,
          },
          startedAt: reserved.startedAt,
          finishedAt: new Date().toISOString(),
        },
        tx,
      );
  });
  return {
    status:
      result === "pending"
        ? ("cancelling" as const)
        : result === "complete"
          ? ("running" as const)
          : result === "failed"
            ? ("error" as const)
            : ("cancelled" as const),
  };
}

async function readCurrentQueryStates(projectId: string) {
  const current = await requireCurrentWorkspace();
  const project = await getReadableProjectDocument(
    { ownerEmail: current.ownerEmail, orgId: current.orgId },
    projectId,
  );
  if (!project)
    fail("That project is not in this workspace.", {
      statusCode: 404,
      errorCode: "project_not_found",
    });
  const sqlCells = project.cells.filter((cell) => cell.contents.kind === "sql");
  const generations =
    sqlCells.length === 0
      ? []
      : await getDb()
          .select({
            cellId: schema.cellOutputGenerations.cellId,
            generation: schema.cellOutputGenerations.generation,
          })
          .from(schema.cellOutputGenerations)
          .where(
            and(
              eq(schema.cellOutputGenerations.projectId, projectId),
              inArray(
                schema.cellOutputGenerations.cellId,
                sqlCells.map((cell) => cell.id),
              ),
            ),
          );
  const generationByCell = new Map(
    generations.map((item) => [item.cellId, item.generation]),
  );
  const permissions = new Map<string, Promise<boolean>>();
  const entries = await Promise.all(
    sqlCells.map(async (cell): Promise<QueryStateEntry> => {
      if (cell.contents.kind !== "sql") return null;
      const raw = await getUserSetting(
        current.ownerEmail,
        `analytics-2:query:${current.orgId}:${projectId}:${cell.id}`,
        { bypassCache: true },
      );
      if (!raw) return null;
      const parsedState = stateSchema.safeParse(raw);
      if (!parsedState.success) return null;
      const state = parsedState.data;
      const generation = generationByCell.get(cell.id);
      if (
        state.connectionId !== cell.contents.dataConnectionId ||
        state.sourceHash !==
          querySourceHash(cell.contents.source, project.cells) ||
        (generation !== undefined && generation !== state.requestId)
      )
        return null;
      let permission = permissions.get(state.connectionId);
      if (!permission) {
        permission = canReadConnectionResults(state.connectionId);
        permissions.set(state.connectionId, permission);
      }
      if (!(await permission)) return null;
      if (
        generation === undefined &&
        !state.busy &&
        state.status !== "running" &&
        !state.pageToken
      )
        return null;
      if (generation === undefined)
        return [
          cell.id,
          {
            status: "unavailable",
            busy: false,
            hasNextPage: false,
            totalRows: null,
            requestId: state.requestId,
          },
        ] as const;
      const cancellationExpired =
        state.busy &&
        state.cancelRequested === true &&
        state.cancelStartedAt !== undefined &&
        Date.now() - state.cancelStartedAt >= CANCEL_RESERVATION_TIMEOUT_MS;
      return [
        cell.id,
        projectQueryStateSchema.parse({
          status: cancellationExpired
            ? "cancel_unknown"
            : state.cancelRequested && state.status === "running"
              ? "cancelling"
              : state.status,
          busy: state.busy && !cancellationExpired,
          hasNextPage: !!state.pageToken,
          totalRows: state.totalRows,
          requestId: state.requestId,
          ...(state.status === "complete" &&
          state.job &&
          state.pageToken &&
          state.connectionId !== ORGANIZATION_BIGQUERY_SOURCE_ID &&
          state.totalRows &&
          /^\d+$/.test(state.totalRows)
            ? { canSeek: true }
            : {}),
        }),
      ] as const;
    }),
  );
  return {
    project,
    states: Object.fromEntries(entries.filter((entry) => entry !== null)),
  };
}

export async function getProjectQueryState(
  projectId: string,
  cellId: string,
): Promise<z.infer<typeof projectQueryStateSchema> | null> {
  const { project, states } = await readCurrentQueryStates(projectId);
  if (!project.cells.some((cell) => cell.id === cellId))
    fail("That cell is not in this project.", {
      statusCode: 404,
      errorCode: "project_cell_not_found",
    });
  return states[cellId] ?? null;
}

export async function getProjectQueryStates(projectId: string) {
  return (await readCurrentQueryStates(projectId)).states;
}
