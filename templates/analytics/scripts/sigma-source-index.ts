import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const MAX_PAGES = 100;
const MAX_WORKBOOKS = 1_000;
const MAX_REVIEWED_ELEMENTS = 1_000;
const MAX_TABLE_REFS = 24;
const SAFE_SIGMA_ID = /^[A-Za-z0-9_-]{1,200}$/;
const SAFE_COLUMN = /^[A-Za-z_][A-Za-z0-9_.$-]{0,119}$/;
const SAFE_TABLE_REF = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,2}$/;
const SENSITIVE_TEXT =
  /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|https?:\/\/|\b(?:bearer|api[_ -]?key|secret|password|token)\s*[:=]\s*\S+|\b\d{3}[-.\s)]?\d{3}[-.\s]?\d{4}\b|\b\d{13,19}\b)/i;

export interface SigmaReviewManifest {
  schemaVersion: 1;
  items: Array<{ workbookId: string; elementIds: string[] }>;
}

export interface SigmaSourceIndex {
  source: { id: "sigma"; contentFingerprint: string };
  entries: Array<{
    id: string;
    metric: string;
    definition: string;
    source: "sigma";
    table?: string;
    columnsUsed?: string;
    knownGotchas: string;
  }>;
}

interface SigmaWorkbook {
  workbookId?: string;
  name?: string;
  description?: string;
  updatedAt?: string;
}

interface SigmaElement {
  elementId?: string;
  name?: string;
  type?: string;
  columns?: unknown[];
}

interface SigmaQuery {
  elementId?: string;
  sql?: string;
}

type FetchLike = typeof fetch;

export function parseSigmaReviewManifest(value: unknown): SigmaReviewManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Sigma review manifest must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    !Array.isArray(record.items) ||
    record.items.length === 0 ||
    record.items.length > MAX_WORKBOOKS
  ) {
    throw new Error("Sigma review manifest has an unsupported shape.");
  }
  const workbookIds = new Set<string>();
  let elementCount = 0;
  const items = record.items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Sigma review manifest contains an invalid workbook.");
    }
    const workbook = item as Record<string, unknown>;
    const workbookId = workbook.workbookId;
    const elementIds = workbook.elementIds;
    if (
      typeof workbookId !== "string" ||
      !SAFE_SIGMA_ID.test(workbookId) ||
      workbookIds.has(workbookId) ||
      !Array.isArray(elementIds) ||
      elementIds.length === 0
    ) {
      throw new Error("Sigma review manifest contains an invalid workbook.");
    }
    workbookIds.add(workbookId);
    const seenElements = new Set<string>();
    const parsedElementIds = elementIds.map((elementId) => {
      if (
        typeof elementId !== "string" ||
        !SAFE_SIGMA_ID.test(elementId) ||
        seenElements.has(elementId)
      ) {
        throw new Error("Sigma review manifest contains an invalid element.");
      }
      seenElements.add(elementId);
      elementCount += 1;
      return elementId;
    });
    return { workbookId, elementIds: parsedElementIds };
  });
  if (elementCount > MAX_REVIEWED_ELEMENTS) {
    throw new Error("Sigma review manifest contains too many elements.");
  }
  return { schemaVersion: 1, items };
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("SIGMA_BASE_URL must be an HTTPS Sigma API URL.");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname.toLowerCase().endsWith(".sigmacomputing.com") ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error("SIGMA_BASE_URL must be an HTTPS Sigma API origin.");
  }
  return url.origin;
}

async function jsonRequest<T>(
  fetcher: FetchLike,
  url: URL,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch {
    throw new Error("Sigma API request failed before a response was received.");
  }
  if (!response.ok) {
    throw new Error(`Sigma API request failed (${response.status}).`);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error("Sigma API returned an invalid JSON response.");
  }
}

async function createToken(args: {
  fetcher: FetchLike;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: args.clientId,
    client_secret: args.clientSecret,
  });
  const result = await jsonRequest<{ access_token?: string }>(
    args.fetcher,
    new URL("/v2/auth/token", args.baseUrl),
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  if (typeof result.access_token !== "string" || !result.access_token) {
    throw new Error("Sigma API did not return an access token.");
  }
  return result.access_token;
}

async function listAll<T>(args: {
  fetcher: FetchLike;
  baseUrl: string;
  token: string;
  path: string;
}): Promise<T[]> {
  const entries: T[] = [];
  let page: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const url = new URL(args.path, args.baseUrl);
    url.searchParams.set("limit", "1000");
    if (page) url.searchParams.set("page", page);
    const response = await jsonRequest<{
      entries?: unknown;
      nextPage?: unknown;
    }>(args.fetcher, url, {
      headers: { authorization: `Bearer ${args.token}` },
    });
    if (!Array.isArray(response.entries)) {
      throw new Error("Sigma API returned a page without an entries list.");
    }
    entries.push(...(response.entries as T[]));
    if (entries.length > MAX_REVIEWED_ELEMENTS * 4) {
      throw new Error("Sigma API metadata exceeds the configured scan limit.");
    }
    if (typeof response.nextPage !== "string" || !response.nextPage) {
      return entries;
    }
    page = response.nextPage;
  }
  throw new Error("Sigma API pagination exceeded the configured page limit.");
}

function redactSqlLiteralsAndComments(sql: string): string {
  let output = "";
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockComment = false;
  let escaped = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]!;
    const next = sql[index + 1];
    if (lineComment) {
      if (char === "\n") {
        output += "\n";
        lineComment = false;
      } else output += " ";
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        output += "  ";
        index += 1;
        blockComment = false;
      } else output += char === "\n" ? "\n" : " ";
      continue;
    }
    if (quote) {
      if (quote === "`" && char !== "`") {
        output += char;
      } else if (quote === "`") {
        output += char;
        if (next === "`") {
          output += next;
          index += 1;
        } else quote = null;
      } else {
        output += char === "\n" ? "\n" : " ";
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = null;
      }
      continue;
    }
    if (char === "-" && next === "-") {
      output += "  ";
      index += 1;
      lineComment = true;
    } else if (char === "/" && next === "*") {
      output += "  ";
      index += 1;
      blockComment = true;
    } else if (char === "`" || char === "'" || char === '"') {
      quote = char;
      output += char === "`" ? char : " ";
    } else output += char;
  }
  return output;
}

export function extractSigmaTableReferences(sql: string): string[] {
  const source = redactSqlLiteralsAndComments(sql);
  const tables = new Set<string>();
  const reference =
    /\b(?:from|join)\s+((?:`[^`]+`|[A-Za-z0-9_-]+)(?:\s*\.\s*(?:`[^`]+`|[A-Za-z0-9_-]+)){0,2})/gi;
  for (const match of source.matchAll(reference)) {
    const table = match[1]!.replace(/`/g, "").replace(/\s+/g, "");
    if (SAFE_TABLE_REF.test(table)) tables.add(table);
    if (tables.size >= MAX_TABLE_REFS) break;
  }
  return [...tables].sort();
}

function safeText(value: string, max: number): string {
  const cleaned = value.trim().replace(/\s+/g, " ").slice(0, max);
  if (!cleaned || SENSITIVE_TEXT.test(cleaned)) {
    throw new Error(
      "A reviewed Sigma title contains unsupported sensitive text.",
    );
  }
  return cleaned;
}

function shortEntryId(workbookId: string, elementId: string): string {
  const digest = createHash("sha256")
    .update(`${workbookId}\n${elementId}`)
    .digest("hex")
    .slice(0, 24);
  return `sigma-${digest}`;
}

export async function buildSigmaSourceIndex(args: {
  manifestPath: string;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  fetcher?: FetchLike;
}): Promise<SigmaSourceIndex> {
  const fetcher = args.fetcher ?? fetch;
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  if (!args.clientId.trim() || !args.clientSecret.trim()) {
    throw new Error("Sigma client credentials are required for indexing.");
  }
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(await readFile(args.manifestPath, "utf8"));
  } catch {
    throw new Error("Sigma review manifest could not be read as JSON.");
  }
  const manifest = parseSigmaReviewManifest(rawManifest);
  const token = await createToken({
    fetcher,
    baseUrl,
    clientId: args.clientId,
    clientSecret: args.clientSecret,
  });
  const workbooks = await listAll<SigmaWorkbook>({
    fetcher,
    baseUrl,
    token,
    path: "/v2/workbooks",
  });
  const workbookById = new Map(
    workbooks
      .filter(
        (workbook) =>
          typeof workbook.workbookId === "string" && workbook.workbookId,
      )
      .map((workbook) => [workbook.workbookId!, workbook]),
  );
  const entries: SigmaSourceIndex["entries"] = [];
  const fingerprintRecords: unknown[] = [];

  for (const selection of manifest.items) {
    const workbook = workbookById.get(selection.workbookId);
    if (!workbook) {
      throw new Error("A reviewed Sigma workbook is no longer accessible.");
    }
    const workbookName = safeText(workbook.name ?? "", 180);
    const elements = await listAll<SigmaElement>({
      fetcher,
      baseUrl,
      token,
      path: `/v2/workbooks/${encodeURIComponent(selection.workbookId)}/elements`,
    });
    const queries = await listAll<SigmaQuery>({
      fetcher,
      baseUrl,
      token,
      path: `/v2/workbooks/${encodeURIComponent(selection.workbookId)}/queries`,
    });
    const elementById = new Map(
      elements
        .filter(
          (element) =>
            typeof element.elementId === "string" && element.elementId,
        )
        .map((element) => [element.elementId!, element]),
    );
    const queryByElementId = new Map(
      queries
        .filter(
          (query) =>
            typeof query.elementId === "string" &&
            typeof query.sql === "string",
        )
        .map((query) => [query.elementId!, query.sql!]),
    );

    for (const elementId of selection.elementIds) {
      const element = elementById.get(elementId);
      if (!element) {
        throw new Error("A reviewed Sigma element is no longer accessible.");
      }
      const elementName = safeText(element.name ?? "", 180);
      const columns = Array.isArray(element.columns)
        ? element.columns
            .filter(
              (column): column is string =>
                typeof column === "string" && SAFE_COLUMN.test(column),
            )
            .slice(0, 100)
        : [];
      const tables = extractSigmaTableReferences(
        queryByElementId.get(elementId) ?? "",
      );
      const entry = {
        id: shortEntryId(selection.workbookId, elementId),
        metric: `${workbookName}: ${elementName}`,
        definition: `Reviewed Sigma ${safeText(element.type ?? "element", 80)} example. Confirm its meaning and grain against dbt before using it as a canonical definition.`,
        source: "sigma" as const,
        ...(tables.length ? { table: tables.join(", ").slice(0, 600) } : {}),
        ...(columns.length
          ? { columnsUsed: columns.join(", ").slice(0, 2_000) }
          : {}),
        knownGotchas:
          "Example metadata only. Use dbt for canonical schema and grain, then verify the current query against live data.",
      };
      entries.push(entry);
      fingerprintRecords.push({
        workbookId: selection.workbookId,
        updatedAt: workbook.updatedAt ?? "",
        elementId,
        name: elementName,
        type: element.type ?? "",
        columns,
        tables,
      });
    }
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  const contentFingerprint = createHash("sha256")
    .update(JSON.stringify(fingerprintRecords))
    .digest("hex");
  return {
    source: { id: "sigma", contentFingerprint },
    entries,
  };
}
