import { executeProviderApiRequest } from "../provider-api";

const SIGMA_PAGE_SIZE = 100;
const SIGMA_WORKBOOK_PAGE_SIZE = 1_000;
const SIGMA_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const SIGMA_MAX_QUERY_PAGES = 100;
const SIGMA_MAX_QUERY_COUNT = 10_000;
const SIGMA_MAX_SOURCE_CONNECTIONS = 100;
const SIGMA_SOURCE_CONNECTION_LOOKUP_CONCURRENCY = 5;
const SIGMA_MAX_QUERY_SQL_CHARS = 64_000;
const SIGMA_MAX_TOTAL_SQL_CHARS = 512_000;

const SIGMA_BETA_LIMITATION =
  "Sigma workbook code representations are public Beta. The representation does not include source data and Sigma documents that some workbook features and configurations are not represented, including tagged versions, comments, sharing, input-table data-entry configuration, and webhook HMAC authentication. The returned representation cannot flag behavior omitted by Sigma.";

export interface SigmaWorkbookSummary {
  workbookId: string;
  name: string;
  updatedAt?: string;
  path?: string;
  latestVersion?: number;
  isArchived?: boolean;
}

export interface SigmaWorkbookListPage {
  workbooks: SigmaWorkbookSummary[];
  nextPage: string | null;
  total?: number;
}

export interface ListSigmaWorkbooksArgs {
  connectionId: string;
  page?: string;
  limit?: number;
}

export interface InspectSigmaWorkbookArgs {
  connectionId: string;
  workbookId: string;
  includeSqlQueries: boolean;
}

export interface SigmaPortablePage {
  id: string;
  name: string;
}

export interface SigmaPortableColumn {
  id: string;
  formula?: string;
  name?: string;
  label?: string;
}

export interface SigmaPortableSource {
  kind?: string;
  connectionId?: string;
  elementId?: string;
  path?: string[];
  sigmaType?: string | null;
  targetProviderCandidate?: "bigquery" | null;
}

export interface SigmaPortableAxisColumn {
  columnId: string;
  formula?: string;
  name?: string;
  label?: string;
  type?: string;
}

export interface SigmaPortablePlacement {
  gridColumn?: string;
  gridRow?: string;
}

interface SigmaPageAssignment {
  pageId: string;
  tab: string;
  placement?: SigmaPortablePlacement;
}

export interface SigmaPortablePanel {
  kind: "panel";
  id: string;
  title: string;
  chartType:
    | "table"
    | "bar"
    | "line"
    | "area"
    | "pie"
    | "combo"
    | "metric"
    | "funnel";
  pageId?: string;
  tab?: string;
  source: SigmaPortableSource | null;
  columns: SigmaPortableColumn[];
  axes?: {
    x?: SigmaPortableAxisColumn;
    y: SigmaPortableAxisColumn[];
  };
  placement?: SigmaPortablePlacement;
}

export interface SigmaUnsupportedElement {
  kind: "unsupported";
  id: string;
  title: string;
  sigmaKind: string;
  pageId?: string;
  tab?: string;
  placement?: SigmaPortablePlacement;
}

export type SigmaPortableElement = SigmaPortablePanel | SigmaUnsupportedElement;

export interface SigmaAdapterDiagnostic {
  code: string;
  severity: "warning" | "error";
  message: string;
  elementId?: string;
  connectionId?: string;
  sigmaKind?: string;
  fieldPath?: string;
  fields?: string[];
}

export interface SigmaSourceConnectionInfo {
  connectionId: string;
  /** Lowercase Sigma connection type, such as `bigquery` or `snowflake`. */
  sigmaType: string | null;
  /** Candidate Analytics source provider; action code must verify a matching workspace connection. */
  targetProviderCandidate: "bigquery" | null;
}

/**
 * SQL in this type is for server-side migration only. Action handlers must
 * return `summarizeSigmaWorkbookInspection` instead of serializing this result.
 */
export interface SigmaWorkbookSqlQuery {
  elementId?: string;
  name?: string;
  sql?: string;
  sqlOmittedReason?:
    | "query-error"
    | "missing-sql"
    | "query-too-large"
    | "total-sql-limit";
  hasError: boolean;
}

export interface SigmaWorkbookInspection {
  workbook: {
    workbookId: string;
    name: string;
    documentVersion?: number;
    latestVersion?: number;
    updatedAt?: string;
  };
  pages: SigmaPortablePage[];
  elements: SigmaPortableElement[];
  sourceConnections: SigmaSourceConnectionInfo[];
  /** Server-only SQL; strip with `summarizeSigmaWorkbookInspection` for actions. */
  sqlQueries: SigmaWorkbookSqlQuery[];
  diagnostics: SigmaAdapterDiagnostic[];
}

export interface SigmaWorkbookInspectionSummary {
  workbook: SigmaWorkbookInspection["workbook"];
  pages: SigmaPortablePage[];
  elements: SigmaPortableElement[];
  sourceConnections: SigmaSourceConnectionInfo[];
  queryCount: number;
  queriesWithSqlCount: number;
  queriesOmittedCount: number;
  diagnostics: SigmaAdapterDiagnostic[];
}

type ProviderApiResponse = {
  ok?: unknown;
  status?: unknown;
  truncated?: unknown;
  json?: unknown;
};

type ProviderApiResult = { response?: ProviderApiResponse };

class SigmaApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function requireConnectionId(value: string): string {
  const connectionId = value.trim();
  if (!connectionId) {
    throw new Error("A Sigma workspace connection is required.");
  }
  return connectionId;
}

function requireWorkbookId(value: string): string {
  const workbookId = value.trim();
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(workbookId)) {
    throw new Error("A valid Sigma workbook ID is required.");
  }
  return workbookId;
}

async function sigmaGetJson(args: {
  connectionId: string;
  path: string;
  query?: Record<string, string | number | boolean>;
}): Promise<unknown> {
  const result = (await executeProviderApiRequest({
    provider: "sigma",
    method: "GET",
    path: args.path,
    query: args.query,
    connectionId: args.connectionId,
    timeoutMs: 30_000,
    maxBytes: SIGMA_MAX_RESPONSE_BYTES,
  })) as ProviderApiResult;

  const response = result?.response;
  if (!response || typeof response !== "object") {
    throw new Error("Sigma API returned an unexpected response.");
  }
  if (response.truncated === true) {
    throw new Error(
      "Sigma API response exceeded the adapter size limit; no partial result was used.",
    );
  }
  if (response.ok !== true) {
    const status = typeof response.status === "number" ? response.status : null;
    throw new SigmaApiRequestError(
      `Sigma API request failed${status === null ? "" : ` (${status})`}.`,
      status,
    );
  }
  if (response.json === undefined) {
    throw new Error("Sigma API returned no JSON data.");
  }
  return response.json;
}

function parseWorkbookSummary(value: unknown): SigmaWorkbookSummary {
  if (!isRecord(value)) {
    throw new Error("Sigma API returned an invalid workbook entry.");
  }
  const workbookId = asOptionalString(value.workbookId);
  const name = asOptionalString(value.name);
  if (!workbookId || !name) {
    throw new Error("Sigma API returned a workbook without an ID or name.");
  }
  const updatedAt = asOptionalString(value.updatedAt);
  const path = asOptionalString(value.path);
  const latestVersion = optionalNumber(value.latestVersion);
  return {
    workbookId,
    name,
    ...(updatedAt ? { updatedAt } : {}),
    ...(path ? { path } : {}),
    ...(latestVersion !== undefined ? { latestVersion } : {}),
    ...(typeof value.isArchived === "boolean"
      ? { isArchived: value.isArchived }
      : {}),
  };
}

function parsePageEnvelope(
  value: unknown,
  label: string,
): {
  entries: unknown[];
  nextPage: string | null;
  total?: number;
} {
  if (!isRecord(value) || !Array.isArray(value.entries)) {
    throw new Error(`Sigma ${label} response did not contain an entries list.`);
  }
  if (
    !Object.prototype.hasOwnProperty.call(value, "nextPage") ||
    (value.nextPage !== null && typeof value.nextPage !== "string")
  ) {
    throw new Error(
      `Sigma ${label} response did not contain a valid nextPage.`,
    );
  }
  if (typeof value.nextPage === "string" && !value.nextPage.trim()) {
    throw new Error(
      `Sigma ${label} response contained an empty nextPage cursor.`,
    );
  }
  const nextPage = value.nextPage as string | null;
  const total = optionalNumber(value.total);
  return {
    entries: value.entries,
    nextPage,
    ...(total !== undefined ? { total } : {}),
  };
}

export async function listSigmaWorkbooks(
  args: ListSigmaWorkbooksArgs,
): Promise<SigmaWorkbookListPage> {
  const connectionId = requireConnectionId(args.connectionId);
  const limit = args.limit ?? 100;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > SIGMA_WORKBOOK_PAGE_SIZE
  ) {
    throw new Error(
      `Sigma workbook page limit must be between 1 and ${SIGMA_WORKBOOK_PAGE_SIZE}.`,
    );
  }
  const page = args.page?.trim();
  if (args.page !== undefined && (!page || page.length > 2_000)) {
    throw new Error("Sigma workbook page cursor is invalid.");
  }

  const payload = await sigmaGetJson({
    connectionId,
    path: "/v2/workbooks",
    query: { limit, ...(page ? { page } : {}) },
  });
  const response = parsePageEnvelope(payload, "workbook list");
  return {
    workbooks: response.entries.map(parseWorkbookSummary),
    nextPage: response.nextPage,
    ...(response.total !== undefined ? { total: response.total } : {}),
  };
}

function getPageAssignments(
  layout: unknown,
  pages: SigmaPortablePage[],
  diagnostics: SigmaAdapterDiagnostic[],
): Map<string, SigmaPageAssignment> {
  const assignments = new Map<string, SigmaPageAssignment>();
  if (typeof layout !== "string" || !layout.trim()) {
    diagnostics.push({
      code: "sigma_layout_missing",
      severity: "warning",
      message:
        "Sigma did not return a workbook layout; page placement is unknown.",
    });
    return assignments;
  }

  const pagePattern = /<Page\b([^>]*)>([\s\S]*?)<\/Page\s*>/gi;
  for (const match of layout.matchAll(pagePattern)) {
    const attributes = match[1] ?? "";
    const pageId = attributes.match(/\bid=["']([^"']+)["']/i)?.[1];
    if (!pageId) continue;
    const page = pages.find((item) => item.id === pageId);
    if (!page) {
      diagnostics.push({
        code: "sigma_layout_unknown_page",
        severity: "warning",
        message:
          "Sigma layout references a page absent from the returned page list.",
      });
      continue;
    }
    const pageBody = match[2] ?? "";
    const elementPattern = /<[^>]*\belementId=["']([^"']+)["'][^>]*>/gi;
    for (const elementMatch of pageBody.matchAll(elementPattern)) {
      const elementId = elementMatch[1];
      if (!elementId) continue;
      const tag = elementMatch[0];
      const gridColumn = tag.match(/\bgridColumn=["']([^"']+)["']/i)?.[1];
      const gridRow = tag.match(/\bgridRow=["']([^"']+)["']/i)?.[1];
      assignments.set(elementId, {
        pageId,
        tab: page.name,
        ...(gridColumn || gridRow
          ? {
              placement: {
                ...(gridColumn ? { gridColumn } : {}),
                ...(gridRow ? { gridRow } : {}),
              },
            }
          : {}),
      });
    }
  }
  return assignments;
}

function parsePortableColumns(
  value: unknown,
  elementId: string,
  diagnostics: SigmaAdapterDiagnostic[],
): SigmaPortableColumn[] {
  if (!Array.isArray(value)) {
    diagnostics.push({
      code: "sigma_element_columns_missing",
      severity: "warning",
      message: "Sigma element has no readable column list.",
      elementId,
    });
    return [];
  }
  const columns: SigmaPortableColumn[] = [];
  for (const [index, column] of value.entries()) {
    if (!isRecord(column) || typeof column.id !== "string" || !column.id) {
      diagnostics.push({
        code: "sigma_element_column_invalid",
        severity: "warning",
        message: "Sigma element contains a column without a usable ID.",
        elementId,
        fieldPath: `columns[${index}]`,
      });
      continue;
    }
    if (
      column.formula !== undefined &&
      (typeof column.formula !== "string" || !column.formula.trim())
    ) {
      diagnostics.push({
        code: "sigma_column_formula_invalid",
        severity: "warning",
        message:
          "Sigma column formula was not a usable string and could not be migrated.",
        elementId,
        fieldPath: `columns[${index}].formula`,
      });
    }
    const formula = asOptionalString(column.formula);
    const name = asOptionalString(column.name);
    const label = asOptionalString(column.label);
    const extraFields = Object.keys(column).filter(
      (key) => !["id", "formula", "name", "label"].includes(key),
    );
    if (extraFields.length > 0) {
      diagnostics.push({
        code: "sigma_column_properties_not_migrated",
        severity: "warning",
        message:
          "Some Sigma column configuration is not included in the portable panel.",
        elementId,
        fieldPath: `columns[${index}]`,
        fields: extraFields.sort(),
      });
    }
    columns.push({
      id: column.id,
      ...(formula ? { formula } : {}),
      ...(name ? { name } : {}),
      ...(label ? { label } : {}),
    });
  }
  return columns;
}

function parsePortableSource(
  value: unknown,
  elementId: string,
  diagnostics: SigmaAdapterDiagnostic[],
): SigmaPortableSource | null {
  if (!isRecord(value)) return null;
  const kind = asOptionalString(value.kind);
  const connectionId = asOptionalString(value.connectionId);
  const sourceElementId = asOptionalString(value.elementId);
  if (
    value.connectionId !== undefined &&
    typeof value.connectionId !== "string"
  ) {
    diagnostics.push({
      code: "sigma_source_connection_id_invalid",
      severity: "warning",
      message:
        "Sigma source connection ID was not a string and could not be inspected.",
      elementId,
    });
  }
  if (value.elementId !== undefined && typeof value.elementId !== "string") {
    diagnostics.push({
      code: "sigma_source_element_id_invalid",
      severity: "warning",
      message:
        "Sigma source element ID was not a string and could not be followed.",
      elementId,
    });
  }
  const pathParts = Array.isArray(value.path)
    ? value.path.filter((part): part is string => typeof part === "string")
    : undefined;
  if (
    value.path !== undefined &&
    (!Array.isArray(value.path) || pathParts?.length !== value.path.length)
  ) {
    diagnostics.push({
      code: "sigma_source_path_incomplete",
      severity: "warning",
      message:
        "Some Sigma source path values were invalid and were omitted from the portable source.",
      elementId,
      fieldPath: "source.path",
    });
  }
  return {
    ...(kind ? { kind } : {}),
    ...(connectionId ? { connectionId } : {}),
    ...(sourceElementId ? { elementId: sourceElementId } : {}),
    ...(pathParts && pathParts.length > 0 ? { path: pathParts } : {}),
  };
}

function axisColumn(
  value: unknown,
  columns: SigmaPortableColumn[],
  elementId: string,
  axis: string,
  diagnostics: SigmaAdapterDiagnostic[],
): SigmaPortableAxisColumn | undefined {
  const columnId = isRecord(value) ? value.columnId : value;
  if (columnId === undefined || columnId === null) return undefined;
  if (typeof columnId !== "string" || !columnId.trim()) {
    diagnostics.push({
      code: "sigma_chart_axis_column_id_invalid",
      severity: "warning",
      message: `Sigma chart ${axis} column ID was not a usable string.`,
      elementId,
    });
    return undefined;
  }
  const column = columns.find((candidate) => candidate.id === columnId);
  const type = isRecord(value) ? asOptionalString(value.type) : undefined;
  if (!column) {
    diagnostics.push({
      code: "sigma_chart_axis_column_missing",
      severity: "warning",
      message: `Sigma chart ${axis} references a column not present in its definition.`,
      elementId,
    });
    return { columnId, ...(type ? { type } : {}) };
  }
  return {
    columnId,
    ...(column.formula ? { formula: column.formula } : {}),
    ...(column.name ? { name: column.name } : {}),
    ...(column.label ? { label: column.label } : {}),
    ...(type ? { type } : {}),
  };
}

function placementFor(
  assignment: SigmaPageAssignment | undefined,
): Pick<SigmaPortablePanel, "pageId" | "tab" | "placement"> {
  if (!assignment) return {};
  return {
    pageId: assignment.pageId,
    tab: assignment.tab,
    ...(assignment.placement ? { placement: assignment.placement } : {}),
  };
}

function reportUnmappedFields(args: {
  value: RecordValue;
  supportedFields: string[];
  fieldPath: string;
  elementId: string;
  sigmaKind: string;
  diagnostics: SigmaAdapterDiagnostic[];
}): void {
  const fields = Object.keys(args.value)
    .filter((field) => !args.supportedFields.includes(field))
    .sort();
  if (fields.length === 0) return;
  args.diagnostics.push({
    code: "sigma_element_properties_not_migrated",
    severity: "warning",
    message:
      "Some Sigma element configuration is not included in the portable panel.",
    elementId: args.elementId,
    sigmaKind: args.sigmaKind,
    fieldPath: args.fieldPath,
    fields,
  });
}

function fallbackSigmaElementId(
  index: number,
  reservedIds: Set<string>,
): string {
  const base = `unrecognized-element-${index + 1}`;
  let candidate = base;
  let suffix = 1;
  while (reservedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  reservedIds.add(candidate);
  return candidate;
}

function parseSigmaElement(
  value: unknown,
  index: number,
  pageAssignments: Map<string, SigmaPageAssignment>,
  diagnostics: SigmaAdapterDiagnostic[],
  reservedIds: Set<string>,
): SigmaPortableElement {
  if (!isRecord(value)) {
    const id = fallbackSigmaElementId(index, reservedIds);
    diagnostics.push({
      code: "sigma_element_invalid",
      severity: "warning",
      message: "Sigma returned a workbook element with an invalid shape.",
      elementId: id,
      fieldPath: `contents.elements[${index}]`,
    });
    return {
      kind: "unsupported",
      id,
      title: `Unrecognized Sigma element ${index + 1}`,
      sigmaKind: "unknown",
    };
  }
  const id = asOptionalString(value.id);
  const sigmaKind = asOptionalString(value.kind);
  if (!id || id.length > 200 || !sigmaKind) {
    const elementId =
      id && id.length <= 200 ? id : fallbackSigmaElementId(index, reservedIds);
    const kind = sigmaKind?.slice(0, 80) ?? "unknown";
    diagnostics.push({
      code: "sigma_element_identity_missing",
      severity: "warning",
      message: "Sigma returned a workbook element without a usable ID or kind.",
      elementId,
      ...(sigmaKind ? { sigmaKind: kind } : {}),
      fieldPath: `contents.elements[${index}]`,
    });
    return {
      kind: "unsupported",
      id: elementId,
      title:
        asOptionalString(value.title)?.slice(0, 200) ??
        asOptionalString(value.name)?.slice(0, 200) ??
        `Unrecognized Sigma element ${index + 1}`,
      sigmaKind: kind,
      ...placementFor(pageAssignments.get(id ?? "")),
    };
  }
  const title =
    asOptionalString(value.title) ?? asOptionalString(value.name) ?? id;
  const assignment = pageAssignments.get(id);
  const placement = placementFor(assignment);
  const chartTypeBySigmaKind: Record<string, SigmaPortablePanel["chartType"]> =
    {
      table: "table",
      "bar-chart": "bar",
      "line-chart": "line",
      "area-chart": "area",
      "pie-chart": "pie",
      "donut-chart": "pie",
      "combo-chart": "combo",
      "kpi-chart": "metric",
      "funnel-chart": "funnel",
    };
  const chartType = chartTypeBySigmaKind[sigmaKind];
  if (!chartType) {
    const unsupported: SigmaUnsupportedElement = {
      kind: "unsupported",
      id,
      title,
      sigmaKind,
      ...placement,
    };
    diagnostics.push({
      code: "sigma_element_unsupported",
      severity: "warning",
      message:
        "This Sigma element is preserved as an unsupported-element diagnostic for manual migration.",
      elementId: id,
      sigmaKind,
    });
    return unsupported;
  }

  const columns = parsePortableColumns(value.columns, id, diagnostics);
  const source = parsePortableSource(value.source, id, diagnostics);
  if (!source) {
    diagnostics.push({
      code: "sigma_element_source_missing",
      severity: "warning",
      message: "Sigma element source metadata could not be mapped.",
      elementId: id,
      sigmaKind,
    });
  }
  let axes: SigmaPortablePanel["axes"];
  if (sigmaKind === "combo-chart") {
    const xAxis = isRecord(value.xAxis) ? value.xAxis : {};
    const yAxis = isRecord(value.yAxis) ? value.yAxis : {};
    const x = axisColumn(xAxis.columnId, columns, id, "x-axis", diagnostics);
    const yValues = Array.isArray(yAxis.columnIds) ? yAxis.columnIds : [];
    const y = yValues
      .map((column) => axisColumn(column, columns, id, "y-axis", diagnostics))
      .filter((column): column is SigmaPortableAxisColumn => !!column);
    axes = { ...(x ? { x } : {}), y };
  } else if (sigmaKind === "funnel-chart") {
    const stage = isRecord(value.stage) ? value.stage : {};
    const series = isRecord(value.series) ? value.series : {};
    const x = axisColumn(stage.columnId, columns, id, "stage", diagnostics);
    const y = axisColumn(series.columnId, columns, id, "series", diagnostics);
    axes = { ...(x ? { x } : {}), y: y ? [y] : [] };
  } else if (sigmaKind === "kpi-chart") {
    const valueColumn = isRecord(value.value) ? value.value : {};
    const y = axisColumn(
      valueColumn.columnId,
      columns,
      id,
      "value",
      diagnostics,
    );
    axes = { y: y ? [y] : [] };
  } else if (sigmaKind === "table") {
    axes = undefined;
  } else {
    const xAxis = isRecord(value.xAxis) ? value.xAxis : {};
    const yAxis = isRecord(value.yAxis) ? value.yAxis : {};
    const x = axisColumn(xAxis.columnId, columns, id, "x-axis", diagnostics);
    const yValues = Array.isArray(yAxis.columnIds) ? yAxis.columnIds : [];
    const y = yValues
      .map((columnId) =>
        axisColumn(columnId, columns, id, "y-axis", diagnostics),
      )
      .filter((column): column is SigmaPortableAxisColumn => !!column);
    axes = { ...(x ? { x } : {}), y };
  }

  const nestedConfigs: { field: string; supportedFields: string[] }[] =
    sigmaKind === "table"
      ? []
      : sigmaKind === "funnel-chart"
        ? [
            { field: "stage", supportedFields: ["columnId"] },
            { field: "series", supportedFields: ["columnId"] },
          ]
        : sigmaKind === "kpi-chart"
          ? [{ field: "value", supportedFields: ["columnId"] }]
          : [
              { field: "xAxis", supportedFields: ["columnId"] },
              { field: "yAxis", supportedFields: ["columnIds"] },
            ];
  const knownFields = [
    "id",
    "kind",
    "name",
    "title",
    "source",
    "columns",
    "order",
    ...nestedConfigs.map(({ field }) => field),
  ];
  reportUnmappedFields({
    value,
    supportedFields: knownFields,
    fieldPath: "element",
    elementId: id,
    sigmaKind,
    diagnostics,
  });

  for (const { field, supportedFields } of nestedConfigs) {
    const nestedValue = value[field];
    if (nestedValue === undefined) continue;
    if (!isRecord(nestedValue)) {
      diagnostics.push({
        code: "sigma_element_config_invalid",
        severity: "warning",
        message: `Sigma element ${field} configuration was not an object and could not be migrated.`,
        elementId: id,
        sigmaKind,
        fieldPath: field,
      });
      continue;
    }
    reportUnmappedFields({
      value: nestedValue,
      supportedFields,
      fieldPath: field,
      elementId: id,
      sigmaKind,
      diagnostics,
    });
    if (field !== "yAxis" || !Array.isArray(nestedValue.columnIds)) continue;
    for (const [axisIndex, axisValue] of nestedValue.columnIds.entries()) {
      if (!isRecord(axisValue)) continue;
      reportUnmappedFields({
        value: axisValue,
        supportedFields: ["columnId", "type"],
        fieldPath: `yAxis.columnIds[${axisIndex}]`,
        elementId: id,
        sigmaKind,
        diagnostics,
      });
    }
  }

  return {
    kind: "panel",
    id,
    title,
    chartType,
    ...placement,
    source,
    columns,
    ...(axes ? { axes } : {}),
  };
}

function parsePages(value: unknown): SigmaPortablePage[] {
  if (!Array.isArray(value)) {
    throw new Error("Sigma workbook representation did not contain pages.");
  }
  return value.map((page, index) => {
    if (!isRecord(page)) {
      throw new Error(`Sigma workbook page ${index + 1} is invalid.`);
    }
    const id = asOptionalString(page.id);
    const name = asOptionalString(page.name);
    if (!id || !name) {
      throw new Error(`Sigma workbook page ${index + 1} has no ID or name.`);
    }
    return { id, name };
  });
}

function resolveSourceConnectionId(
  elementId: string,
  elementsById: Map<string, RecordValue>,
  visited = new Set<string>(),
): string | undefined {
  if (visited.has(elementId)) return undefined;
  visited.add(elementId);
  const element = elementsById.get(elementId);
  if (!element || !isRecord(element.source)) return undefined;
  const directConnectionId = asOptionalString(element.source.connectionId);
  if (directConnectionId) return directConnectionId;
  const sourceElementId = asOptionalString(element.source.elementId);
  return sourceElementId
    ? resolveSourceConnectionId(sourceElementId, elementsById, visited)
    : undefined;
}

function collectSourceConnectionIds(elements: unknown[]): {
  elementsById: Map<string, RecordValue>;
  connectionIds: string[];
} {
  const elementsById = new Map<string, RecordValue>();
  const connectionIds = new Set<string>();
  for (const value of elements) {
    if (!isRecord(value)) continue;
    const id = asOptionalString(value.id);
    if (id) elementsById.set(id, value);
    if (!isRecord(value.source)) continue;
    const connectionId = asOptionalString(value.source.connectionId);
    if (connectionId) connectionIds.add(connectionId);
  }
  if (connectionIds.size > SIGMA_MAX_SOURCE_CONNECTIONS) {
    throw new Error(
      `Sigma workbook references more than ${SIGMA_MAX_SOURCE_CONNECTIONS} data connections; no partial inspection was returned.`,
    );
  }
  return { elementsById, connectionIds: [...connectionIds].sort() };
}

async function loadSigmaSourceConnections(args: {
  connectionId: string;
  sourceConnectionIds: string[];
  diagnostics: SigmaAdapterDiagnostic[];
}): Promise<SigmaSourceConnectionInfo[]> {
  const connections: SigmaSourceConnectionInfo[] = [];
  for (
    let offset = 0;
    offset < args.sourceConnectionIds.length;
    offset += SIGMA_SOURCE_CONNECTION_LOOKUP_CONCURRENCY
  ) {
    const batch = args.sourceConnectionIds.slice(
      offset,
      offset + SIGMA_SOURCE_CONNECTION_LOOKUP_CONCURRENCY,
    );
    const results = await Promise.all(
      batch.map(
        async (
          sourceConnectionId,
        ): Promise<{
          info: SigmaSourceConnectionInfo;
          diagnostic: SigmaAdapterDiagnostic;
        }> => {
          try {
            const payload = await sigmaGetJson({
              connectionId: args.connectionId,
              path: `/v2/connections/${encodeURIComponent(sourceConnectionId)}`,
            });
            if (
              !isRecord(payload) ||
              payload.connectionId !== sourceConnectionId
            ) {
              return {
                info: {
                  connectionId: sourceConnectionId,
                  sigmaType: null,
                  targetProviderCandidate: null,
                } satisfies SigmaSourceConnectionInfo,
                diagnostic: {
                  code: "sigma_source_connection_lookup_invalid",
                  severity: "error",
                  message:
                    "Sigma connection details did not match the requested source connection.",
                  connectionId: sourceConnectionId,
                } satisfies SigmaAdapterDiagnostic,
              };
            }
            const sigmaType =
              asOptionalString(payload.type)?.toLowerCase() ?? null;
            return {
              info: {
                connectionId: sourceConnectionId,
                sigmaType,
                targetProviderCandidate:
                  sigmaType === "bigquery" ? "bigquery" : null,
              } satisfies SigmaSourceConnectionInfo,
              diagnostic: (!sigmaType
                ? {
                    code: "sigma_source_connection_type_missing",
                    severity: "warning",
                    message:
                      "Sigma did not return a type for this source connection; its target compatibility is unknown.",
                    connectionId: sourceConnectionId,
                  }
                : sigmaType === "bigquery"
                  ? {
                      code: "sigma_bigquery_source_requires_target_mapping",
                      severity: "warning",
                      message:
                        "This Sigma BigQuery source is only a candidate; verify an Analytics BigQuery workspace connection and SQL compatibility before execution.",
                      connectionId: sourceConnectionId,
                    }
                  : {
                      code: "sigma_source_connection_unsupported",
                      severity: "warning",
                      message: `Sigma source type '${sigmaType}' has no supported Analytics target mapping in this migration adapter.`,
                      connectionId: sourceConnectionId,
                    }) satisfies SigmaAdapterDiagnostic,
            };
          } catch (error) {
            return {
              info: {
                connectionId: sourceConnectionId,
                sigmaType: null,
                targetProviderCandidate: null,
              } satisfies SigmaSourceConnectionInfo,
              diagnostic:
                error instanceof SigmaApiRequestError &&
                error.status !== null &&
                error.status >= 400 &&
                error.status < 500 &&
                error.status !== 408 &&
                error.status !== 429
                  ? ({
                      code: "sigma_source_connection_unavailable",
                      severity: "warning",
                      message:
                        "Sigma did not allow access to this source connection; its target compatibility is unknown.",
                      connectionId: sourceConnectionId,
                    } satisfies SigmaAdapterDiagnostic)
                  : ({
                      code: "sigma_source_connection_lookup_failed",
                      severity: "error",
                      message:
                        "Sigma source connection type could not be inspected; its target compatibility is unknown.",
                      connectionId: sourceConnectionId,
                    } satisfies SigmaAdapterDiagnostic),
            };
          }
        },
      ),
    );
    for (const result of results) {
      connections.push(result.info);
      if (result.diagnostic) args.diagnostics.push(result.diagnostic);
    }
  }
  return connections;
}

function attachSourceConnectionMetadata(args: {
  elements: SigmaPortableElement[];
  elementsById: Map<string, RecordValue>;
  sourceConnections: SigmaSourceConnectionInfo[];
  diagnostics: SigmaAdapterDiagnostic[];
}): SigmaPortableElement[] {
  const connectionsById = new Map(
    args.sourceConnections.map((connection) => [
      connection.connectionId,
      connection,
    ]),
  );
  return args.elements.map((element) => {
    if (element.kind !== "panel" || !element.source) return element;
    const connectionId =
      element.source.connectionId ??
      (element.source.elementId
        ? resolveSourceConnectionId(element.source.elementId, args.elementsById)
        : undefined);
    if (!connectionId) {
      args.diagnostics.push({
        code: "sigma_panel_source_connection_unresolved",
        severity: "warning",
        message:
          "The panel's Sigma data connection could not be resolved from its source elements.",
        elementId: element.id,
      });
      return element;
    }
    const connection = connectionsById.get(connectionId);
    return {
      ...element,
      source: {
        ...element.source,
        connectionId,
        ...(connection
          ? {
              sigmaType: connection.sigmaType,
              targetProviderCandidate: connection.targetProviderCandidate,
            }
          : { sigmaType: null, targetProviderCandidate: null }),
      },
    };
  });
}

async function loadAllSqlQueries(args: {
  connectionId: string;
  workbookId: string;
  diagnostics: SigmaAdapterDiagnostic[];
}): Promise<SigmaWorkbookSqlQuery[]> {
  const queries: SigmaWorkbookSqlQuery[] = [];
  const seenCursors = new Set<string>();
  let page: string | undefined;
  let totalSqlChars = 0;

  for (
    let pageNumber = 0;
    pageNumber < SIGMA_MAX_QUERY_PAGES;
    pageNumber += 1
  ) {
    const payload = await sigmaGetJson({
      connectionId: args.connectionId,
      path: `/v2/workbooks/${encodeURIComponent(args.workbookId)}/queries`,
      query: {
        limit: SIGMA_PAGE_SIZE,
        ...(page ? { page } : {}),
      },
    });
    const response = parsePageEnvelope(payload, "workbook SQL query list");
    const pageOffset = queries.length;
    for (const [index, entry] of response.entries.entries()) {
      if (!isRecord(entry)) {
        throw new Error("Sigma SQL query list contained an invalid entry.");
      }
      if (queries.length >= SIGMA_MAX_QUERY_COUNT) {
        throw new Error(
          "Sigma workbook SQL query count exceeds the adapter limit; no partial inspection was returned.",
        );
      }
      const elementId = asOptionalString(entry.elementId);
      const name = asOptionalString(entry.name);
      const sql = typeof entry.sql === "string" ? entry.sql : undefined;
      const hasError =
        typeof entry.error === "string" && entry.error.trim().length > 0;
      if (!elementId) {
        args.diagnostics.push({
          code: "sigma_sql_query_element_id_missing",
          severity: "warning",
          message:
            "Sigma SQL query entry did not identify its workbook element.",
          fieldPath: `queries[${pageOffset + index}].elementId`,
        });
      }
      if (hasError) {
        queries.push({
          ...(elementId ? { elementId } : {}),
          ...(name ? { name } : {}),
          hasError: true,
          sqlOmittedReason: "query-error",
        });
        args.diagnostics.push({
          code: "sigma_sql_query_error",
          severity: "warning",
          message:
            "Sigma reported an error for this workbook SQL query; its SQL was not used for migration.",
          ...(elementId ? { elementId } : {}),
        });
        continue;
      }
      if (sql === undefined) {
        queries.push({
          ...(elementId ? { elementId } : {}),
          ...(name ? { name } : {}),
          hasError: false,
          sqlOmittedReason: "missing-sql",
        });
        args.diagnostics.push({
          code: "sigma_sql_query_missing",
          severity: "warning",
          message:
            "Sigma SQL query entry had neither SQL text nor an error explanation.",
          ...(elementId ? { elementId } : {}),
        });
        continue;
      }
      if (sql.length > SIGMA_MAX_QUERY_SQL_CHARS) {
        queries.push({
          ...(elementId ? { elementId } : {}),
          ...(name ? { name } : {}),
          hasError: false,
          sqlOmittedReason: "query-too-large",
        });
        args.diagnostics.push({
          code: "sigma_sql_query_too_large",
          severity: "warning",
          message: `Sigma SQL query exceeds the ${SIGMA_MAX_QUERY_SQL_CHARS}-character migration bound and was omitted.`,
          ...(elementId ? { elementId } : {}),
        });
        continue;
      }
      if (totalSqlChars + sql.length > SIGMA_MAX_TOTAL_SQL_CHARS) {
        queries.push({
          ...(elementId ? { elementId } : {}),
          ...(name ? { name } : {}),
          hasError: false,
          sqlOmittedReason: "total-sql-limit",
        });
        args.diagnostics.push({
          code: "sigma_sql_total_limit",
          severity: "warning",
          message:
            "The workbook SQL total exceeds the migration bound; remaining SQL was omitted.",
          ...(elementId ? { elementId } : {}),
        });
        continue;
      }
      totalSqlChars += sql.length;
      queries.push({
        ...(elementId ? { elementId } : {}),
        ...(name ? { name } : {}),
        sql,
        hasError: false,
      });
    }

    if (!response.nextPage) return queries;
    if (seenCursors.has(response.nextPage)) {
      throw new Error("Sigma SQL query pagination repeated a page cursor.");
    }
    seenCursors.add(response.nextPage);
    page = response.nextPage;
  }

  throw new Error(
    "Sigma SQL query pagination exceeded the adapter limit; no partial inspection was returned.",
  );
}

export async function inspectSigmaWorkbook(
  args: InspectSigmaWorkbookArgs,
): Promise<SigmaWorkbookInspection> {
  const connectionId = requireConnectionId(args.connectionId);
  const workbookId = requireWorkbookId(args.workbookId);
  const payload = await sigmaGetJson({
    connectionId,
    path: `/v2/workbooks/${encodeURIComponent(workbookId)}`,
    query: { includeContents: true },
  });
  if (!isRecord(payload) || !isRecord(payload.contents)) {
    throw new Error(
      "Sigma did not return the workbook code representation; verify Beta API access and workbook permissions.",
    );
  }
  const contents = payload.contents;
  if (contents.kind !== "workbook") {
    throw new Error("Sigma returned a non-workbook code representation.");
  }
  if (!Array.isArray(contents.elements)) {
    throw new Error("Sigma workbook representation did not contain elements.");
  }
  if (
    typeof contents.schemaVersion !== "number" ||
    !Number.isFinite(contents.schemaVersion)
  ) {
    throw new Error("Sigma workbook representation had no schema version.");
  }
  const returnedId = asOptionalString(payload.workbookId);
  const name = asOptionalString(payload.name);
  const documentVersion = optionalNumber(payload.documentVersion);
  if (!returnedId || returnedId !== workbookId || !name) {
    throw new Error(
      "Sigma workbook response did not match the requested workbook.",
    );
  }
  const pages = parsePages(contents.pages);
  const diagnostics: SigmaAdapterDiagnostic[] = [
    {
      code: "sigma_beta_representation_may_omit_features",
      severity: "warning",
      message: SIGMA_BETA_LIMITATION,
    },
  ];
  if (contents.schemaVersion !== 1) {
    diagnostics.push({
      code: "sigma_schema_version_unrecognized",
      severity: "warning",
      message: `Sigma returned workbook representation schema version ${contents.schemaVersion}; field mapping may be incomplete.`,
    });
  }
  const pageAssignments = getPageAssignments(
    contents.layout,
    pages,
    diagnostics,
  );
  const sourceGraph = collectSourceConnectionIds(contents.elements);
  const reservedElementIds = new Set(sourceGraph.elementsById.keys());
  const parsedElements = contents.elements.map((element, index) =>
    parseSigmaElement(
      element,
      index,
      pageAssignments,
      diagnostics,
      reservedElementIds,
    ),
  );
  const sourceConnections = await loadSigmaSourceConnections({
    connectionId,
    sourceConnectionIds: sourceGraph.connectionIds,
    diagnostics,
  });
  const elements = attachSourceConnectionMetadata({
    elements: parsedElements,
    elementsById: sourceGraph.elementsById,
    sourceConnections,
    diagnostics,
  });
  const knownContentFields = new Set([
    "schemaVersion",
    "kind",
    "elements",
    "pages",
    "layout",
  ]);
  const extraContentFields = Object.keys(contents).filter(
    (key) => !knownContentFields.has(key),
  );
  if (extraContentFields.length > 0) {
    diagnostics.push({
      code: "sigma_workbook_properties_not_migrated",
      severity: "warning",
      message:
        "Some Sigma workbook-level configuration is not included in the portable inspection.",
      fields: extraContentFields.sort(),
    });
  }
  for (const element of contents.elements) {
    if (
      isRecord(element) &&
      typeof element.id === "string" &&
      !pageAssignments.has(element.id)
    ) {
      diagnostics.push({
        code: "sigma_element_placement_missing",
        severity: "warning",
        message:
          "Sigma layout did not place this element on a returned page; destination placement requires review.",
        elementId: element.id,
      });
    }
  }

  const sqlQueries = args.includeSqlQueries
    ? await loadAllSqlQueries({ connectionId, workbookId, diagnostics })
    : [];
  for (const query of sqlQueries) {
    if (
      query.elementId &&
      !contents.elements.some(
        (element) => isRecord(element) && element.id === query.elementId,
      )
    ) {
      diagnostics.push({
        code: "sigma_sql_query_element_unmatched",
        severity: "warning",
        message:
          "Sigma SQL query did not match an element in the returned code representation.",
        elementId: query.elementId,
      });
    }
  }
  const latestVersion = optionalNumber(payload.latestVersion);
  const updatedAt = asOptionalString(payload.updatedAt);

  return {
    workbook: {
      workbookId,
      name,
      ...(documentVersion !== undefined ? { documentVersion } : {}),
      ...(latestVersion !== undefined ? { latestVersion } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    },
    pages,
    elements,
    sourceConnections,
    sqlQueries,
    diagnostics,
  };
}

export function summarizeSigmaWorkbookInspection(
  inspection: SigmaWorkbookInspection,
): SigmaWorkbookInspectionSummary {
  return {
    workbook: inspection.workbook,
    pages: inspection.pages,
    elements: inspection.elements,
    sourceConnections: inspection.sourceConnections,
    queryCount: inspection.sqlQueries.length,
    queriesWithSqlCount: inspection.sqlQueries.filter(
      (query) => query.sql !== undefined,
    ).length,
    queriesOmittedCount: inspection.sqlQueries.filter(
      (query) => query.sqlOmittedReason !== undefined,
    ).length,
    diagnostics: inspection.diagnostics,
  };
}
