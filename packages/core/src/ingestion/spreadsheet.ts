export type SpreadsheetDocumentType = "xlsx" | "xls";

export interface ParseSpreadsheetDocumentInput {
  data: Uint8Array;
  fileName: string;
  mimeType?: string;
  maxBytes?: number;
  maxChars?: number;
  maxColumns?: number;
  maxRowsPerSheet?: number;
  maxSheets?: number;
}

export interface ParsedSpreadsheetSheet {
  index: number;
  title: string;
  text: string;
  metadata: {
    sheetName: string;
    rowCount: number;
    columnCount: number;
    sampledRowCount: number;
    sampledColumnCount: number;
    truncated: boolean;
  };
}

export interface ParsedSpreadsheetDocument {
  text: string;
  fileType: SpreadsheetDocumentType;
  title: string;
  parser: "sheetjs-workbook";
  parts: ParsedSpreadsheetSheet[];
  metadata: {
    sheetNames: string[];
    sheetCount: number;
    sampledSheetCount: number;
    truncated: boolean;
  };
  warnings: string[];
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_CHARS = 24_000;
const DEFAULT_MAX_COLUMNS = 24;
const DEFAULT_MAX_ROWS_PER_SHEET = 40;
const DEFAULT_MAX_SHEETS = 12;
const MAX_CELL_CHARS = 500;

type XlsxModule = typeof import("xlsx");

export function isSpreadsheetDocument(
  fileName: string,
  mimeType?: string,
): boolean {
  return detectSpreadsheetDocumentType(fileName, mimeType) !== null;
}

export function detectSpreadsheetDocumentType(
  fileName: string,
  mimeType?: string,
): SpreadsheetDocumentType | null {
  const normalizedMime = mimeType?.toLowerCase().split(";")[0].trim() ?? "";
  if (
    normalizedMime ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    normalizedMime === "application/vnd.ms-excel"
  ) {
    return normalizedMime.includes("openxml") ? "xlsx" : "xls";
  }

  const extension = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return extension === "xlsx" || extension === "xls" ? extension : null;
}

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value)
    .replace(/\r\n?/g, " ")
    .replace(/[\t\n]+/g, " ")
    .trim()
    .slice(0, MAX_CELL_CHARS);
}

function escapePreviewValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function loadXlsx(): Promise<XlsxModule> {
  try {
    return await import("xlsx");
  } catch {
    throw new Error(
      "Parsing Excel workbooks requires the optional xlsx dependency.",
    );
  }
}

function appendBoundedText(
  current: string,
  next: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (maxChars <= 0) return { text: "", truncated: true };
  const separator = current ? "\n\n" : "";
  const remaining = maxChars - current.length - separator.length;
  if (remaining <= 0) return { text: current, truncated: true };
  if (next.length <= remaining) {
    return { text: `${current}${separator}${next}`, truncated: false };
  }

  const marker = "\n[Spreadsheet preview truncated.]";
  const markerText = marker.slice(0, remaining);
  const available = Math.max(0, remaining - markerText.length);
  return {
    text: `${current}${separator}${next.slice(0, available)}${markerText}`,
    truncated: true,
  };
}

export async function parseSpreadsheetDocument(
  input: ParseSpreadsheetDocumentInput,
): Promise<ParsedSpreadsheetDocument> {
  const fileType = detectSpreadsheetDocumentType(
    input.fileName,
    input.mimeType,
  );
  if (!fileType) {
    throw new Error(
      `Unsupported spreadsheet type ${input.mimeType ?? input.fileName}. Expected XLS or XLSX.`,
    );
  }

  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  if (input.data.byteLength > maxBytes) {
    throw new Error(
      `Spreadsheet exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB parsing limit.`,
    );
  }

  const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
  const maxColumns = input.maxColumns ?? DEFAULT_MAX_COLUMNS;
  const maxRowsPerSheet = input.maxRowsPerSheet ?? DEFAULT_MAX_ROWS_PER_SHEET;
  const maxSheets = input.maxSheets ?? DEFAULT_MAX_SHEETS;
  const xlsx = await loadXlsx();
  const workbook = xlsx.read(input.data, {
    type: "array",
    cellDates: true,
    cellNF: false,
    cellText: true,
  });
  const sheetNames = workbook.SheetNames.map(String);
  if (sheetNames.length === 0) {
    throw new Error("Spreadsheet does not contain any worksheets.");
  }

  const parts: ParsedSpreadsheetSheet[] = [];
  let text = "";
  let truncated = false;
  for (const [index, sheetName] of sheetNames.slice(0, maxSheets).entries()) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const range = sheet["!ref"]
      ? xlsx.utils.decode_range(sheet["!ref"] as string)
      : null;
    const rowCount = range ? range.e.r - range.s.r + 1 : 0;
    const columnCount = range ? range.e.c - range.s.c + 1 : 0;
    const rows = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      blankrows: false,
      defval: "",
    });
    const sampledRows = rows.slice(0, maxRowsPerSheet);
    const sampledColumnCount = Math.min(
      maxColumns,
      sampledRows.reduce((max, row) => Math.max(max, row.length), 0),
    );
    const lines = [
      `Sheet: ${sheetName}`,
      `Rows: ${rowCount}; columns: ${columnCount}`,
      `Preview rows: ${sampledRows.length}; preview columns: ${sampledColumnCount}`,
    ];
    if (sampledRows.length === 0) {
      lines.push("(empty sheet)");
    } else {
      for (const row of sampledRows) {
        lines.push(
          row
            .slice(0, maxColumns)
            .map((cell) => escapePreviewValue(normalizeCell(cell)))
            .join("\t"),
        );
      }
    }
    const sheetTruncated =
      sampledRows.length < rowCount || sampledColumnCount < columnCount;
    if (sheetTruncated) {
      lines.push(
        "[This sheet preview is bounded; use the original workbook for the remaining rows or columns.]",
      );
    }

    const sheetText = lines.join("\n");
    const bounded = appendBoundedText(text, sheetText, maxChars);
    text = bounded.text;
    if (bounded.truncated) {
      truncated = true;
      break;
    }
    parts.push({
      index,
      title: sheetName,
      text: sheetText,
      metadata: {
        sheetName,
        rowCount,
        columnCount,
        sampledRowCount: sampledRows.length,
        sampledColumnCount,
        truncated: sheetTruncated,
      },
    });
  }

  if (sheetNames.length > maxSheets) truncated = true;
  const warnings: string[] = [];
  if (sheetNames.length > maxSheets) {
    warnings.push(
      `Only the first ${maxSheets} of ${sheetNames.length} worksheets were included in the preview.`,
    );
  }
  if (
    truncated &&
    !warnings.some((warning) => warning.includes("worksheets"))
  ) {
    warnings.push(
      `The preview was limited to ${maxChars.toLocaleString()} characters.`,
    );
  }

  return {
    text,
    fileType,
    title: input.fileName,
    parser: "sheetjs-workbook",
    parts,
    metadata: {
      sheetNames,
      sheetCount: sheetNames.length,
      sampledSheetCount: parts.length,
      truncated,
    },
    warnings,
  };
}
