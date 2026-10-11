export interface DictionaryExportEntry {
  id?: unknown;
  metric?: unknown;
  definition?: unknown;
  department?: unknown;
  source?: unknown;
  table?: unknown;
  columnsUsed?: unknown;
  cuts?: unknown;
  queryTemplate?: unknown;
  exampleOutput?: unknown;
  joinPattern?: unknown;
  updateFrequency?: unknown;
  dataLag?: unknown;
  dependencies?: unknown;
  validDateRange?: unknown;
  commonQuestions?: unknown;
  knownGotchas?: unknown;
  exampleUseCase?: unknown;
  owner?: unknown;
  status?: unknown;
  approved?: unknown;
  aiGenerated?: unknown;
  sourceUrl?: unknown;
  sourceIndex?: unknown;
  updatedAt?: unknown;
}

interface DictionaryPage {
  results: DictionaryExportEntry[];
  nextPage: string | null;
}

export const DICTIONARY_EXPORT_PAGE_SIZE = 200;
export const DICTIONARY_EXPORT_MAX_PAGES = 25;

export class DictionaryExportError extends Error {
  constructor(readonly kind: "invalid_page" | "cursor_loop" | "page_limit") {
    super(`Dictionary export stopped: ${kind}.`);
    this.name = "DictionaryExportError";
  }
}

function parseDictionaryPage(value: unknown): DictionaryPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DictionaryExportError("invalid_page");
  }
  const page = value as Record<string, unknown>;
  if (
    !Array.isArray(page.results) ||
    !(page.nextPage === null || typeof page.nextPage === "string")
  ) {
    throw new DictionaryExportError("invalid_page");
  }
  return {
    results: page.results as DictionaryExportEntry[],
    nextPage: page.nextPage,
  };
}

export async function collectDictionaryEntries(
  fetchPage: (nextPage?: string) => Promise<unknown>,
  maxPages = DICTIONARY_EXPORT_MAX_PAGES,
): Promise<DictionaryExportEntry[]> {
  const entries: DictionaryExportEntry[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const page = parseDictionaryPage(await fetchPage(cursor));
    entries.push(...page.results);
    if (page.nextPage === null) return entries;
    if (seenCursors.has(page.nextPage)) {
      throw new DictionaryExportError("cursor_loop");
    }
    seenCursors.add(page.nextPage);
    cursor = page.nextPage;
  }

  throw new DictionaryExportError("page_limit");
}

const EXPORT_FIELDS = [
  "id",
  "metric",
  "definition",
  "department",
  "source",
  "table",
  "columnsUsed",
  "cuts",
  "queryTemplate",
  "exampleOutput",
  "joinPattern",
  "updateFrequency",
  "dataLag",
  "dependencies",
  "validDateRange",
  "commonQuestions",
  "knownGotchas",
  "exampleUseCase",
  "owner",
  "status",
  "approved",
  "aiGenerated",
  "sourceUrl",
  "sourceIndex",
  "updatedAt",
] as const satisfies ReadonlyArray<keyof DictionaryExportEntry>;

function exportValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value) ?? "";
}

function csvCell(value: unknown): string {
  let text = exportValue(value);
  if (/^\s*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function dictionaryEntriesToCsv(
  entries: DictionaryExportEntry[],
): string {
  const header = EXPORT_FIELDS.map(csvCell).join(",");
  const rows = entries.map((entry) =>
    EXPORT_FIELDS.map((field) => csvCell(entry[field])).join(","),
  );
  return [header, ...rows].join("\r\n");
}
