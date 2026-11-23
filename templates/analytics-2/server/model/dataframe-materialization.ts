import { createHash } from "node:crypto";

import { fail } from "@agent-native/core/action";
import {
  deletePrivateBlob,
  isPrivateBlobConfiguredForRequest,
  putPrivateBlob,
  readPrivateBlob,
} from "@agent-native/core/private-blob";
import { z } from "zod";

import {
  tableOutputSchema,
  type CellContents,
  type CellOutput,
} from "../../app/lib/model/contracts.js";

type Table = Extract<CellOutput, { type: "table" }>;
const storedTableSchema = tableOutputSchema.extend({
  columns: z.array(
    tableOutputSchema.shape.columns.element
      .extend({ sqlType: z.literal("float").optional() })
      .refine((column) => !column.sqlType || column.type === "number"),
  ),
});
type StoredTable = z.infer<typeof storedTableSchema>;
export const dataframeProviderType = Symbol("dataframeProviderType");

type Page = {
  columns: { name: string; type: string; [dataframeProviderType]?: string }[];
  rows: unknown[][];
  jobComplete: boolean;
  hasNextPage: boolean;
  pageToken: string | null;
  totalRows: string | null;
  jobReference?: {
    projectId: string;
    jobId: string;
    location?: string | undefined;
  } | null;
  jobIdentity?: string;
};

const MAX_ROWS = 10_000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PAGES = 20;

function unavailable(message: string): never {
  fail(message, {
    statusCode: 422,
    errorCode: "project_dataframe_materialization_failed",
  });
}

function columnType(type: string): Table["columns"][number]["type"] {
  if (
    /^(?:INT64|INTEGER|NUMERIC|BIGNUMERIC|DECIMAL|BIGDECIMAL|FLOAT|FLOAT64|DOUBLE|REAL)$/i.test(
      type,
    )
  )
    return "number";
  if (/^(?:BOOL|BOOLEAN)$/i.test(type)) return "boolean";
  if (/^(?:STRING|TEXT|VARCHAR)$/i.test(type)) return "string";
  if (/^DATE$/i.test(type)) return "date";
  if (/^DATETIME$/i.test(type)) return "datetime";
  return unavailable(
    "A warehouse result has a type that cannot be used as a dataframe.",
  );
}

function valueFor(
  value: unknown,
  type: Table["columns"][number]["type"],
  providerType: string,
): Table["rows"][number][number] {
  if (value === null) return null;
  if (type === "number") {
    if (/^(?:FLOAT|FLOAT64|DOUBLE|REAL)$/i.test(providerType)) {
      const number =
        typeof value === "number"
          ? value
          : typeof value === "string" &&
              /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)
            ? Number(value)
            : NaN;
      if (Number.isFinite(number)) return number;
      return unavailable(
        "A warehouse result contains a value that cannot be used as a dataframe.",
      );
    }
    if (/^(?:NUMERIC|BIGNUMERIC|DECIMAL|BIGDECIMAL)$/i.test(providerType)) {
      if (
        typeof value === "string" &&
        /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)
      )
        return value;
      if (typeof value === "number" && Number.isSafeInteger(value))
        return value;
      return unavailable(
        "A warehouse result contains a value that cannot be used as a dataframe.",
      );
    }
    const number =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim()
          ? Number(value)
          : NaN;
    if (
      Number.isFinite(number) &&
      Number.isSafeInteger(number) &&
      (typeof value !== "string" || /^-?\d+$/.test(value)) &&
      /^(?:INT64|INTEGER)$/i.test(providerType)
    )
      return number;
  } else if (type === "boolean") {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
  } else if (typeof value === "string") return value;
  return unavailable(
    "A warehouse result contains a value that cannot be used as a dataframe.",
  );
}

/** Collect one provider job, failing rather than publishing a partial table. */
export async function collectDataframePages(
  first: Page,
  nextPage: (token: string, previous: Page) => Promise<Page>,
): Promise<StoredTable> {
  if (
    first.totalRows !== null &&
    /^\d+$/.test(first.totalRows) &&
    BigInt(first.totalRows) > BigInt(MAX_ROWS)
  )
    unavailable("The warehouse result exceeds the dataframe size limit.");
  const columns = first.columns.map((column) => ({
    name: column.name,
    type: columnType(column[dataframeProviderType] ?? column.type),
    ...(/^(?:FLOAT|FLOAT64|DOUBLE|REAL)$/i.test(
      column[dataframeProviderType] ?? column.type,
    )
      ? { sqlType: "float" as const }
      : {}),
  }));
  if (
    !columns.length ||
    columns.some((column) => !column.name) ||
    new Set(columns.map((column) => column.name.toLowerCase())).size !==
      columns.length
  )
    unavailable(
      "A warehouse result has invalid or duplicate dataframe columns.",
    );
  const rows: Table["rows"] = [];
  const seen = new Set<string>();
  let page = first;
  let bytes = 0;
  for (let count = 0; count < MAX_PAGES; count++) {
    if (
      !page.jobComplete ||
      JSON.stringify(page.columns) !== JSON.stringify(first.columns) ||
      page.columns.some(
        (column, index) =>
          column[dataframeProviderType] !==
          first.columns[index]?.[dataframeProviderType],
      ) ||
      (first.jobIdentity !== undefined
        ? page.jobIdentity !== first.jobIdentity
        : first.jobReference != null &&
          JSON.stringify(page.jobReference) !==
            JSON.stringify(first.jobReference)) ||
      (first.totalRows !== null &&
        page.totalRows !== null &&
        page.totalRows !== first.totalRows)
    )
      unavailable(
        "The warehouse result is incomplete or changed between pages.",
      );
    for (const row of page.rows) {
      if (row.length !== columns.length)
        unavailable("The warehouse result has an invalid row.");
      const converted = row.map((value, index) => {
        const column = columns[index];
        const providerColumn = first.columns[index];
        if (!column || !providerColumn)
          return unavailable("The warehouse result has an invalid row.");
        return valueFor(
          value,
          column.type,
          providerColumn[dataframeProviderType] ?? providerColumn.type,
        );
      });
      bytes += Buffer.byteLength(JSON.stringify(converted));
      rows.push(converted);
      if (rows.length > MAX_ROWS || bytes > MAX_BYTES)
        unavailable("The warehouse result exceeds the dataframe size limit.");
    }
    if (!page.hasNextPage) {
      const totalRows = first.totalRows ?? page.totalRows;
      if (
        page.pageToken ||
        (totalRows !== null &&
          (!/^\d+$/.test(totalRows) ||
            BigInt(totalRows) !== BigInt(rows.length)))
      )
        unavailable("The warehouse result is incomplete.");
      return {
        type: "table",
        columns,
        rows,
        rowCount: rows.length,
        truncated: false,
      };
    }
    if (!page.pageToken || seen.has(page.pageToken))
      unavailable("The warehouse result is incomplete.");
    seen.add(page.pageToken);
    page = await nextPage(page.pageToken, page);
  }
  return unavailable("The warehouse result exceeds the dataframe page limit.");
}

export function dataframeSnapshot(
  versionId: string,
  cells: { id: string; contents: CellContents }[],
  cellId: string,
): string {
  const semantic = (contents: CellContents) => {
    if (contents.kind === "sql") {
      const {
        kind,
        source,
        dataConnectionId,
        connectionMode,
        databaseSchema,
        resultVariable,
      } = contents;
      return {
        kind,
        source,
        dataConnectionId,
        connectionMode,
        databaseSchema,
        resultVariable,
      };
    }
    if (contents.kind === "input") {
      const { kind, name, inputType, defaultValueString } = contents;
      return { kind, name, inputType, defaultValueString };
    }
    return { kind: contents.kind };
  };
  const cell = cells.find((item) => item.id === cellId);
  const source = cell?.contents.kind === "sql" ? cell.contents.source : "";
  const inputs =
    source.includes("{{") || source.includes("}}")
      ? cells
          .filter((item) => item.contents.kind === "input")
          .map(({ id, contents }) => ({ id, contents: semantic(contents) }))
          .sort((a, b) => a.id.localeCompare(b.id))
      : [];
  return createHash("sha256")
    .update(
      JSON.stringify({
        versionId,
        cell: cell ? { id: cell.id, contents: semantic(cell.contents) } : null,
        inputs,
      }),
    )
    .digest("hex");
}

export async function requireDataframeStorage() {
  let configured: boolean;
  try {
    configured = await isPrivateBlobConfiguredForRequest();
  } catch {
    fail("Private dataframe storage is unavailable.", {
      statusCode: 503,
      errorCode: "project_dataframe_storage_unavailable",
    });
  }
  if (!configured)
    fail("Private storage is required to materialize a dataframe.", {
      statusCode: 503,
      errorCode: "project_dataframe_storage_unavailable",
    });
}

export async function storeDataframe(table: Table, ownerEmail: string) {
  const validated = storedTableSchema.safeParse(table);
  if (!validated.success)
    unavailable(
      "A warehouse result contains a value that cannot be used as a dataframe.",
    );
  if (
    table.truncated ||
    table.rows.length !== table.rowCount ||
    table.rows.length > MAX_ROWS
  )
    unavailable(
      "The dataframe result is incomplete or exceeds the size limit.",
    );
  const data = Buffer.from(JSON.stringify(validated.data));
  if (data.length > MAX_BYTES)
    unavailable("The dataframe result exceeds the size limit.");
  let handle;
  try {
    handle = await putPrivateBlob({
      data,
      ownerEmail,
      mimeType: "application/json",
      metadata: { purpose: "analytics-dataframe" },
    });
  } catch {
    fail("Private dataframe storage is unavailable.", {
      statusCode: 503,
      errorCode: "project_dataframe_storage_unavailable",
    });
  }
  if (!handle)
    fail("Private storage is required to materialize a dataframe.", {
      statusCode: 503,
      errorCode: "project_dataframe_storage_unavailable",
    });
  return { handle, digest: createHash("sha256").update(data).digest("hex") };
}

export async function loadDataframe(reference: {
  handle: {
    id: string;
    provider: string;
    opaque: true;
    encrypted: boolean;
    mimeType?: string | undefined;
    size?: number | undefined;
    createdAt?: string | undefined;
    metadata?:
      | Record<string, string | number | boolean | null | undefined>
      | undefined;
  };
  digest: string;
}): Promise<StoredTable> {
  const {
    id,
    provider,
    opaque,
    encrypted,
    mimeType,
    size,
    createdAt,
    metadata,
  } = reference.handle;
  let data: Uint8Array;
  try {
    ({ data } = await readPrivateBlob({
      id,
      provider,
      opaque,
      encrypted,
      ...(mimeType === undefined ? {} : { mimeType }),
      ...(size === undefined ? {} : { size }),
      ...(createdAt === undefined ? {} : { createdAt }),
      ...(metadata === undefined ? {} : { metadata }),
    }));
  } catch {
    fail("The stored dataframe is unavailable.", {
      statusCode: 503,
      errorCode: "project_dataframe_storage_unavailable",
    });
  }
  if (
    data.byteLength > MAX_BYTES ||
    createHash("sha256").update(data).digest("hex") !== reference.digest
  )
    unavailable("The stored dataframe is invalid or exceeds the size limit.");
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(data).toString("utf8"));
  } catch {
    return unavailable("The stored dataframe is invalid.");
  }
  const result = storedTableSchema.safeParse(raw);
  if (
    !result.success ||
    result.data.materialization ||
    result.data.materializationUnavailable ||
    result.data.truncated ||
    result.data.rowCount !== result.data.rows.length ||
    result.data.rows.length > MAX_ROWS ||
    result.data.rows.some((row) => row.length !== result.data.columns.length)
  )
    unavailable("The stored dataframe is incomplete or invalid.");
  return result.data;
}

export async function discardDataframe(
  handle: Awaited<ReturnType<typeof storeDataframe>>["handle"],
) {
  await deletePrivateBlob(handle);
}

export function withoutDataframeReference(
  output: CellOutput | null,
): CellOutput | null {
  if (output?.type !== "table") return output;
  const copy = {
    ...output,
    columns: output.columns.map(({ name, type }) => ({ name, type })),
  };
  delete copy.materialization;
  delete copy.materializationUnavailable;
  return copy;
}
