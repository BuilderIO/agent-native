import { executeProviderApiRequest } from "./provider-api";

export interface GoogleSheetExportInput {
  dashboardId: string;
  dashboardTitle: string;
  panelId: string;
  panelTitle: string;
  source: string;
  rows: Record<string, unknown>[];
  schema: { name: string; type: string }[];
  truncated?: boolean;
  bytesProcessed?: number;
}

export interface GoogleSheetExportResult {
  spreadsheetUrl: string;
  spreadsheetId: string;
  rowCount: number;
  metadata: {
    dashboardId: string;
    dashboardTitle: string;
    panelId: string;
    panelTitle: string;
    source: string;
    chartType: "table";
    sheetTitle: string;
    columns: string[];
    columnCount: number;
    truncated: boolean;
    bytesProcessed: number | null;
    provider: "google_drive";
    updatedCells: number | null;
  };
}

type ProviderResponse = {
  ok?: boolean;
  status?: number;
  statusText?: string;
  json?: unknown;
};

function providerResponse(result: unknown, label: string): ProviderResponse {
  const response = (result as { response?: unknown } | null)?.response;
  if (!response || typeof response !== "object") {
    throw new Error(`${label} returned an unexpected response.`);
  }
  const typed = response as ProviderResponse;
  if (!typed.ok) {
    const status = typed.status ? ` HTTP ${typed.status}` : "";
    const statusText = typed.statusText ? ` ${typed.statusText}` : "";
    throw new Error(`${label} failed${status}${statusText}.`);
  }
  return typed;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sheetCell(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function normalizeSheetTitle(
  dashboardTitle: string,
  panelTitle: string,
): string {
  const title = `${dashboardTitle} - ${panelTitle}`
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim();
  return (title || "Analytics export").slice(0, 100);
}

function sheetColumnCount(
  schema: GoogleSheetExportInput["schema"],
  rows: GoogleSheetExportInput["rows"],
): string[] {
  const names = schema
    .map((column) => column.name.trim())
    .filter((name, index, columns) => name && columns.indexOf(name) === index);
  if (names.length > 0) return names;
  return Object.keys(rows[0] ?? {});
}

export async function exportDashboardPanelToGoogleSheet(
  input: GoogleSheetExportInput,
): Promise<GoogleSheetExportResult> {
  const columns = sheetColumnCount(input.schema, input.rows);
  const sheetTitle = normalizeSheetTitle(
    input.dashboardTitle,
    input.panelTitle,
  );
  const createResult = await executeProviderApiRequest({
    provider: "google_drive",
    method: "POST",
    path: "https://sheets.googleapis.com/v4/spreadsheets",
    query: {
      fields: "spreadsheetId,spreadsheetUrl,properties.title,sheets.properties",
    },
    body: { properties: { title: sheetTitle } },
  });
  const createResponse = providerResponse(
    createResult,
    "Google Sheet creation",
  );
  const created = asRecord(createResponse.json);
  const spreadsheetId =
    typeof created.spreadsheetId === "string" ? created.spreadsheetId : "";
  if (!spreadsheetId) {
    throw new Error("Google Sheet creation did not return a spreadsheet id.");
  }

  const sheets = Array.isArray(created.sheets) ? created.sheets : [];
  const firstSheet = asRecord(sheets[0]);
  const firstProperties = asRecord(firstSheet.properties);
  const actualSheetTitle =
    typeof firstProperties.title === "string" && firstProperties.title
      ? firstProperties.title
      : "Sheet1";
  let updatedCells: number | null = null;

  if (columns.length > 0) {
    const values = [
      columns,
      ...input.rows.map((row) =>
        columns.map((column) => sheetCell(row[column])),
      ),
    ];
    const updateResult = await executeProviderApiRequest({
      provider: "google_drive",
      method: "PUT",
      path: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${quoteSheetTitle(actualSheetTitle)}!A1`)}`,
      query: { valueInputOption: "RAW" },
      body: {
        range: `${quoteSheetTitle(actualSheetTitle)}!A1`,
        majorDimension: "ROWS",
        values,
      },
    });
    const updateResponse = providerResponse(
      updateResult,
      "Google Sheet values update",
    );
    const updated = asRecord(updateResponse.json);
    updatedCells =
      typeof updated.updatedCells === "number" ? updated.updatedCells : null;
  }

  const spreadsheetUrl =
    typeof created.spreadsheetUrl === "string" && created.spreadsheetUrl
      ? created.spreadsheetUrl
      : `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`;

  return {
    spreadsheetUrl,
    spreadsheetId,
    rowCount: input.rows.length,
    metadata: {
      dashboardId: input.dashboardId,
      dashboardTitle: input.dashboardTitle,
      panelId: input.panelId,
      panelTitle: input.panelTitle,
      source: input.source,
      chartType: "table",
      sheetTitle: actualSheetTitle,
      columns,
      columnCount: columns.length,
      truncated: input.truncated === true,
      bytesProcessed: input.bytesProcessed ?? null,
      provider: "google_drive",
      updatedCells,
    },
  };
}
