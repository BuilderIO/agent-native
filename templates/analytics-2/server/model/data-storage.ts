import { createHash } from "node:crypto";

import { fail, isActionContractError } from "@agent-native/core/action";
import type { Data, DataType, Decimal, Table, Vector } from "apache-arrow";
import { z } from "zod";

/**
 * Job streams are addressed by the coordinates of the query job that produced
 * them: `projects/{project}/locations/{location}/jobs/{job}/streams/_default`.
 * The location comes from the provider job reference; an absent location is a
 * failure, never an inferred default.
 */
const PROJECT_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;
const JOB_PATTERN = /^[A-Za-z0-9_-]{1,1024}$/;
const LOCATION_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export const WAREHOUSE_STORAGE_MAX_PAGE_ROWS = 1000;
export const WAREHOUSE_STORAGE_READ_TIMEOUT_MS = 30_000;
/**
 * The official ReadRows limit is 128 MB per response. Allow a bounded
 * protobuf/encapsulation overhead on top rather than treating the payload
 * limit as the wire-message limit.
 */
export const WAREHOUSE_STORAGE_MAX_RESPONSE_BYTES =
  128 * 1024 * 1024 + 8 * 1024 * 1024;
/**
 * A page may need the documented maximum response plus schema/page metadata.
 * This is a finite decode budget, not a row or UI cap.
 */
export const WAREHOUSE_STORAGE_MAX_RESULT_BYTES = 320 * 1024 * 1024;
export const WAREHOUSE_STORAGE_MAX_NESTED_VALUES = 1_000_000;
export const WAREHOUSE_STORAGE_MAX_NESTED_DEPTH = 32;
/** Release operations are local; a non-settling release is a leaked resource. */
export const WAREHOUSE_STORAGE_CLEANUP_TIMEOUT_MS = 1_000;

// Arrow TimeUnit/DateUnit enum values, kept local so this module does not load
// Apache Arrow until a Storage read actually needs it.
const TIME_UNIT_SECOND = 0;
const TIME_UNIT_MILLISECOND = 1;
const TIME_UNIT_MICROSECOND = 2;
const TIME_UNIT_NANOSECOND = 3;
const DATE_UNIT_DAY = 0;

type ArrowModule = typeof import("apache-arrow");
let arrowModule: Promise<ArrowModule> | undefined;
function loadArrow(): Promise<ArrowModule> {
  arrowModule ??= import("apache-arrow");
  return arrowModule;
}

export interface WarehouseJobCoordinates {
  projectId: string;
  jobId: string;
  location: string;
}

export interface WarehouseQueryColumn {
  name: string;
  type: string;
  mode?: string | undefined;
  fields?: WarehouseQueryColumn[] | undefined;
}

export function warehouseJobStreamName(job: WarehouseJobCoordinates): string {
  if (
    !PROJECT_PATTERN.test(job.projectId) ||
    !JOB_PATTERN.test(job.jobId) ||
    !LOCATION_PATTERN.test(job.location)
  )
    fail("The query job coordinates are invalid.", {
      errorCode: "warehouse_query_job_invalid",
      statusCode: 502,
    });
  return `projects/${job.projectId}/locations/${job.location}/jobs/${job.jobId}/streams/_default`;
}

function canonicalColumns(columns: readonly WarehouseQueryColumn[]): unknown[] {
  return columns.map((column) => [
    column.name,
    column.type,
    column.mode ?? null,
    column.fields ? canonicalColumns(column.fields) : null,
  ]);
}

export function warehouseSchemaFingerprint(
  columns: readonly WarehouseQueryColumn[],
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalColumns(columns)))
    .digest("hex");
}

const cursorSchema = z
  .object({
    version: z.literal(1),
    projectId: z.string().min(1),
    jobId: z.string().min(1),
    location: z.string().min(1),
    // The Storage offset is an int64. Keep it as an exact decimal string so a
    // cursor beyond Number.MAX_SAFE_INTEGER is never rounded.
    offset: z.string().regex(/^\d+$/),
    schemaFingerprint: z.string().min(1),
  })
  .strict();

export interface WarehouseStorageCursor {
  version: 1;
  projectId: string;
  jobId: string;
  location: string;
  offset: bigint;
  schemaFingerprint: string;
}

export interface WarehouseStorageCursorBinding {
  projectId: string;
  jobId?: string | undefined;
  location?: string | undefined;
  schemaFingerprint: string;
}

export function encodeWarehouseStorageCursor(
  cursor: Omit<WarehouseStorageCursor, "version">,
): string {
  if (cursor.offset < 0n)
    fail("The query result cursor is invalid.", {
      errorCode: "warehouse_query_cursor_invalid",
      statusCode: 422,
    });
  return Buffer.from(
    JSON.stringify({
      version: 1,
      ...cursor,
      offset: cursor.offset.toString(),
    }),
    "utf8",
  ).toString("base64url");
}

export function decodeWarehouseStorageCursor(
  token: string,
  expected: WarehouseStorageCursorBinding,
): WarehouseStorageCursor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    fail("The query result cursor is invalid.", {
      errorCode: "warehouse_query_cursor_invalid",
      statusCode: 422,
    });
  }
  const parsed = cursorSchema.safeParse(decoded);
  if (!parsed.success)
    fail("The query result cursor is invalid.", {
      errorCode: "warehouse_query_cursor_invalid",
      statusCode: 422,
    });
  const cursor = parsed.data;
  if (
    cursor.projectId !== expected.projectId ||
    (expected.jobId !== undefined && cursor.jobId !== expected.jobId) ||
    (expected.location !== undefined && cursor.location !== expected.location)
  )
    fail("This query result cursor belongs to a different job.", {
      errorCode: "warehouse_query_job_denied",
      statusCode: 403,
    });
  if (cursor.schemaFingerprint !== expected.schemaFingerprint)
    fail("The query result columns changed. Restart from the first page.", {
      errorCode: "warehouse_query_cursor_stale",
      statusCode: 409,
    });
  return { ...cursor, offset: BigInt(cursor.offset) };
}

export interface StorageReadRowsResponse {
  arrowSchema?: { serializedSchema?: Uint8Array | string | null } | null;
  arrowRecordBatch?: {
    serializedRecordBatch?: Uint8Array | string | null;
    rowCount?: number | string | bigint | null;
  } | null;
  rowCount?: number | string | bigint | null;
  totalEstimatedRowCount?: number | string | bigint | null;
}

export interface StorageReadRowsStream extends AsyncIterable<StorageReadRowsResponse> {
  destroy(error?: Error): void;
  cancel?(): void;
}

export interface WarehouseStorageReader {
  readRows(
    request: { readStream: string; offset: string },
    options?: { timeout: number },
  ): StorageReadRowsStream;
  close(): void | Promise<void>;
}

export interface WarehouseStoragePageRequest {
  projectId: string;
  jobId: string;
  location: string;
  offset: bigint;
  first: number;
  totalRows: bigint;
  columns: readonly WarehouseQueryColumn[];
}

function contractFailure(
  message: string,
  errorCode: string,
  statusCode: number,
  details: Record<string, unknown> = {},
): Error {
  return Object.assign(new Error(message), {
    actionContractError: true,
    errorCode,
    statusCode,
    ...(Object.keys(details).length ? { details } : {}),
  });
}

/** Safe status normalization for raw transport failures; never includes provider text. */
export function normalizeStorageReadFailure(
  error: unknown,
  details: Record<string, unknown> = {},
): Error {
  if (isActionContractError(error))
    return contractFailure(error.message, error.errorCode, error.statusCode, {
      ...error.details,
      ...details,
    });
  const code = Number((error as { code?: unknown } | null)?.code);
  if (Number.isInteger(code) && code >= 1 && code <= 16)
    details = { ...details, grpcStatus: code };
  if (code === 7 || code === 16)
    return contractFailure(
      "Access to this query result was denied. Check the selected connection's permissions.",
      "warehouse_query_denied",
      403,
      details,
    );
  if (code === 6 || code === 9 || code === 10)
    return contractFailure(
      "The query result is not available in its current state.",
      "warehouse_query_conflict",
      409,
      details,
    );
  return contractFailure(
    "Error reading query results. Please try again.",
    "warehouse_query_failed",
    502,
    details,
  );
}

function resultInvalid(message: string): never {
  fail(message, {
    errorCode: "warehouse_query_result_invalid",
    statusCode: 502,
  });
}

function exactCount(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") {
    if (value < 0n) resultInvalid("The query result row count is invalid.");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0)
      resultInvalid("The query result row count is invalid.");
    return BigInt(value);
  }
  const text =
    typeof value === "string"
      ? value
      : typeof value === "object" &&
          typeof (value as { toString?: unknown }).toString === "function"
        ? String(value)
        : "";
  if (!/^\d+$/.test(text))
    resultInvalid("The query result row count is invalid.");
  return BigInt(text);
}

function asBytes(value: Uint8Array | string | null | undefined): Uint8Array {
  if (value instanceof Uint8Array) return value;
  resultInvalid("The storage result payload is unreadable.");
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1)
    if (left[index] !== right[index]) return false;
  return true;
}

function exactInteger(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value))
    return BigInt(value);
  resultInvalid("The query result contains an invalid temporal value.");
}

function floorDivMod(
  value: bigint,
  divisor: bigint,
): { quotient: bigint; remainder: bigint } {
  const quotient = value / divisor;
  const remainder = value % divisor;
  if (remainder < 0n)
    return { quotient: quotient - 1n, remainder: remainder + divisor };
  return { quotient, remainder };
}

/** Proleptic Gregorian civil date from days since 1970-01-01. */
function civilDate(days: bigint): string {
  const shifted = days + 719_468n;
  const era = (shifted >= 0n ? shifted : shifted - 146_096n) / 146_097n;
  const dayOfEra = shifted - era * 146_097n;
  const yearOfEra =
    (dayOfEra - dayOfEra / 1_460n + dayOfEra / 36_524n - dayOfEra / 146_096n) /
    365n;
  const year = yearOfEra + era * 400n;
  const dayOfYear =
    dayOfEra - (365n * yearOfEra + yearOfEra / 4n - yearOfEra / 100n);
  const monthPart = (5n * dayOfYear + 2n) / 153n;
  const day = dayOfYear - (153n * monthPart + 2n) / 5n + 1n;
  const month = monthPart < 10n ? monthPart + 3n : monthPart - 9n;
  return `${(month <= 2n ? year + 1n : year).toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function unitsPerSecond(unit: number): bigint | null {
  switch (unit) {
    case TIME_UNIT_SECOND:
      return 1n;
    case TIME_UNIT_MILLISECOND:
      return 1_000n;
    case TIME_UNIT_MICROSECOND:
      return 1_000_000n;
    case TIME_UNIT_NANOSECOND:
      return 1_000_000_000n;
    default:
      return null;
  }
}

function fractionDigits(unit: number): number | null {
  switch (unit) {
    case TIME_UNIT_SECOND:
      return 0;
    case TIME_UNIT_MILLISECOND:
      return 3;
    case TIME_UNIT_MICROSECOND:
      return 6;
    case TIME_UNIT_NANOSECOND:
      return 9;
    default:
      return null;
  }
}

function formatTimestampValue(
  value: unknown,
  unit: number,
  zoned: boolean,
): string {
  const perSecond = unitsPerSecond(unit);
  const digits = fractionDigits(unit);
  if (perSecond === null || digits === null)
    resultInvalid("The query result timestamp precision is not supported.");
  const parts = floorDivMod(exactInteger(value), perSecond);
  const dayParts = floorDivMod(parts.quotient, 86_400n);
  const micros =
    digits === 0 ? 0n : (parts.remainder * 10n ** BigInt(digits)) / perSecond;
  const fraction =
    micros === 0n
      ? ""
      : `.${micros.toString().padStart(digits, "0").replace(/0+$/, "")}`;
  const hours = (dayParts.remainder / 3_600n).toString().padStart(2, "0");
  const minutes = ((dayParts.remainder % 3_600n) / 60n)
    .toString()
    .padStart(2, "0");
  const seconds = (dayParts.remainder % 60n).toString().padStart(2, "0");
  const suffix = zoned ? "Z" : "";
  return `${civilDate(dayParts.quotient)}T${hours}:${minutes}:${seconds}${fraction}${suffix}`;
}

function formatTimeValue(value: unknown, unit: number): string {
  const perSecond = unitsPerSecond(unit);
  const digits = fractionDigits(unit);
  if (perSecond === null || digits === null)
    resultInvalid("The query result time precision is not supported.");
  const units = exactInteger(value);
  const parts = floorDivMod(units, perSecond);
  if (parts.quotient < 0n || parts.quotient >= 86_400n)
    resultInvalid("The query result contains an invalid time.");
  const micros =
    digits === 0 ? 0n : (parts.remainder * 10n ** BigInt(digits)) / perSecond;
  const fraction =
    micros === 0n
      ? ""
      : `.${micros.toString().padStart(digits, "0").replace(/0+$/, "")}`;
  const hours = (parts.quotient / 3_600n).toString().padStart(2, "0");
  const minutes = ((parts.quotient % 3_600n) / 60n).toString().padStart(2, "0");
  const seconds = (parts.quotient % 60n).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}${fraction}`;
}

function formatDateValue(value: unknown, unit: number): string {
  const units = exactInteger(value);
  const days =
    unit === DATE_UNIT_DAY ? units : floorDivMod(units, 86_400_000n).quotient;
  return civilDate(days);
}

function formatDecimal(value: unknown, scale: number): string {
  const raw = String(value);
  if (!/^-?\d+$/.test(raw) || !Number.isInteger(scale) || scale < 0)
    resultInvalid("The query result contains an invalid decimal value.");
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  const padded = digits.padStart(scale + 1, "0");
  const whole = scale === 0 ? padded : padded.slice(0, padded.length - scale);
  const fraction =
    scale === 0 ? "" : padded.slice(padded.length - scale).replace(/0+$/, "");
  const text = fraction ? `${whole}.${fraction}` : whole;
  return negative && /[1-9]/.test(text) ? `-${text}` : text;
}

function base64(value: unknown): string {
  if (!(value instanceof Uint8Array))
    resultInvalid("The storage result contains an invalid byte value.");
  return Buffer.from(value).toString("base64");
}

function isListType(arrow: ArrowModule, type: DataType): boolean {
  return (
    arrow.DataType.isList(type) ||
    arrow.DataType.isLargeList(type) ||
    arrow.DataType.isFixedSizeList(type)
  );
}

function typeMismatch(): never {
  resultInvalid("The storage result type does not match the query schema.");
}

function unsupportedType(): never {
  fail("The query result type is not supported by the Storage transport.", {
    errorCode: "warehouse_query_type_unsupported",
    statusCode: 502,
  });
}

function assertArrowType(
  arrow: ArrowModule,
  type: DataType,
  column: WarehouseQueryColumn,
): void {
  const declared = column.type.toUpperCase();
  if (column.mode?.toUpperCase() === "REPEATED") {
    if (!isListType(arrow, type)) typeMismatch();
    const child = type.children[0];
    if (!child) typeMismatch();
    assertArrowType(arrow, child.type, { ...column, mode: undefined });
    return;
  }
  if (isListType(arrow, type)) typeMismatch();
  if (declared !== "RECORD" && declared !== "STRUCT" && column.fields?.length)
    typeMismatch();
  switch (declared) {
    case "RECORD":
    case "STRUCT": {
      if (!arrow.DataType.isStruct(type)) typeMismatch();
      if (!column.fields) return;
      if (type.children.length !== column.fields.length) typeMismatch();
      for (const [index, child] of type.children.entries()) {
        const declaredChild = column.fields[index];
        if (!declaredChild || child.name !== declaredChild.name) typeMismatch();
        assertArrowType(arrow, child.type, declaredChild);
      }
      return;
    }
    case "INTEGER":
    case "INT64":
      if (!arrow.DataType.isInt(type) || type.bitWidth !== 64) typeMismatch();
      return;
    case "FLOAT":
    case "FLOAT64":
      if (!arrow.DataType.isFloat(type)) typeMismatch();
      return;
    case "BOOLEAN":
    case "BOOL":
      if (!arrow.DataType.isBool(type)) typeMismatch();
      return;
    case "STRING":
    case "GEOGRAPHY":
    case "JSON":
      if (!arrow.DataType.isUtf8(type)) typeMismatch();
      return;
    case "BYTES":
      if (!arrow.DataType.isBinary(type)) typeMismatch();
      return;
    case "DATE":
      if (!arrow.DataType.isDate(type) || type.unit !== DATE_UNIT_DAY)
        typeMismatch();
      return;
    case "DATETIME":
    case "TIMESTAMP":
      if (
        !arrow.DataType.isTimestamp(type) ||
        type.unit !== TIME_UNIT_MICROSECOND
      )
        typeMismatch();
      return;
    case "TIME":
      if (!arrow.DataType.isTime(type) || type.unit !== TIME_UNIT_MICROSECOND)
        typeMismatch();
      return;
    case "NUMERIC":
      if (!arrow.DataType.isDecimal(type) || type.bitWidth !== 128)
        typeMismatch();
      return;
    case "BIGNUMERIC":
      if (!arrow.DataType.isDecimal(type) || type.bitWidth !== 256)
        typeMismatch();
      return;
    default:
      unsupportedType();
  }
}

function assertArrowSchema(
  arrow: ArrowModule,
  fields: readonly { name: string; type: DataType }[],
  columns: readonly WarehouseQueryColumn[],
): void {
  if (
    fields.length !== columns.length ||
    fields.some((field, index) => field.name !== columns[index]?.name)
  )
    resultInvalid("The storage result columns do not match the query schema.");
  for (const [index, field] of fields.entries()) {
    const column = columns[index];
    if (!column)
      resultInvalid(
        "The storage result columns do not match the query schema.",
      );
    assertArrowType(arrow, field.type, column);
  }
}

interface NestedBudget {
  nested: number;
}

function consumeNested(budget: NestedBudget, count: number): void {
  budget.nested += count;
  if (budget.nested > WAREHOUSE_STORAGE_MAX_NESTED_VALUES)
    resultInvalid("The query result nested values exceed the supported limit.");
}

function primitiveValue(
  arrow: ArrowModule,
  value: unknown,
  type: DataType,
): unknown {
  if (value === null || value === undefined) return null;
  if (arrow.DataType.isInt(type)) return String(value);
  if (arrow.DataType.isFloat(type)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : String(value);
  }
  if (arrow.DataType.isBool(type)) return Boolean(value);
  if (
    arrow.DataType.isBinary(type) ||
    arrow.DataType.isLargeBinary(type) ||
    arrow.DataType.isBinaryView(type) ||
    arrow.DataType.isFixedSizeBinary(type)
  )
    return base64(value);
  if (
    arrow.DataType.isUtf8(type) ||
    arrow.DataType.isLargeUtf8(type) ||
    arrow.DataType.isUtf8View(type)
  )
    return String(value);
  if (arrow.DataType.isDecimal(type))
    return formatDecimal(value, (type as Decimal).scale);
  resultInvalid("The storage result type is not supported.");
}

function timestampIsZoned(declaredType: string, type: DataType): boolean {
  if (declaredType.toUpperCase() === "TIMESTAMP") return true;
  if (declaredType.toUpperCase() === "DATETIME") return false;
  const timezone =
    (type as { timezone?: string | null | undefined }).timezone ?? null;
  return timezone !== null;
}

function singleChunk(vector: Vector): Data {
  const chunks = vector.data;
  const chunk = chunks[0];
  if (!chunk || chunks.length !== 1)
    resultInvalid("The storage result payload has an unsupported layout.");
  return chunk;
}

/**
 * One recursive decoder shared by top-level and nested values. It reads
 * temporal raw integers from the exact Arrow buffers, honors validity bitmaps
 * at every level, and never returns raw ticks for a temporal type.
 */
function decodeCell(
  arrow: ArrowModule,
  vector: Vector,
  index: number,
  type: DataType,
  column: WarehouseQueryColumn,
  budget: NestedBudget,
  depth: number,
): unknown {
  if (depth > WAREHOUSE_STORAGE_MAX_NESTED_DEPTH)
    resultInvalid(
      "The query result nesting depth exceeds the supported limit.",
    );
  if (!vector.isValid(index)) return null;
  if (arrow.DataType.isDictionary(type))
    return decodeCell(
      arrow,
      vector,
      index,
      type.dictionary,
      column,
      budget,
      depth,
    );
  if (arrow.DataType.isDate(type))
    return formatDateValue(rawInteger(vector, index), type.unit);
  if (arrow.DataType.isTimestamp(type))
    return formatTimestampValue(
      rawInteger(vector, index),
      type.unit,
      timestampIsZoned(column.type, type),
    );
  if (arrow.DataType.isTime(type))
    return formatTimeValue(rawInteger(vector, index), type.unit);
  if (arrow.DataType.isStruct(type)) {
    const data = singleChunk(vector);
    const children = data.children;
    if (!children || children.length !== type.children.length)
      resultInvalid("The storage result payload is unreadable.");
    consumeNested(budget, type.children.length);
    const record: Record<string, unknown> = {};
    for (const [childIndex, childField] of type.children.entries()) {
      const declaredChild =
        column.fields?.[childIndex] ??
        ({ name: childField.name, type: "" } satisfies WarehouseQueryColumn);
      const childData = children[childIndex];
      if (!childData)
        resultInvalid("The storage result payload is unreadable.");
      record[childField.name] = decodeCell(
        arrow,
        arrow.makeVector(childData),
        index,
        childField.type,
        declaredChild,
        budget,
        depth + 1,
      );
    }
    return record;
  }
  if (isListType(arrow, type)) {
    const firstChild = type.children[0];
    if (!firstChild) resultInvalid("The storage result payload is unreadable.");
    const childType = firstChild.type;
    const list = vector.get(index) as Vector;
    if (!list || typeof list.length !== "number")
      resultInvalid("The storage result payload is unreadable.");
    consumeNested(budget, list.length);
    const childColumn: WarehouseQueryColumn =
      column.mode?.toUpperCase() === "REPEATED"
        ? { ...column, mode: undefined }
        : (column.fields?.[0] ?? { name: firstChild.name, type: "" });
    return Array.from({ length: list.length }, (_, itemIndex) =>
      decodeCell(
        arrow,
        list,
        itemIndex,
        childType,
        childColumn,
        budget,
        depth + 1,
      ),
    );
  }
  return primitiveValue(arrow, vector.get(index), type);
}

/**
 * Reads one exact raw integer from a single-batch column. Temporal Arrow values
 * are int64 counts; `Vector.get` converts microseconds through milliseconds,
 * so this bypasses it to keep microsecond precision exact.
 */
function rawInteger(vector: Vector, rowIndex: number): bigint | number {
  const chunks = vector.data;
  const chunk = chunks[0];
  if (!chunk || chunks.length !== 1)
    resultInvalid("The storage result payload has an unsupported layout.");
  if (rowIndex >= chunk.length)
    resultInvalid("The storage result payload is unreadable.");
  const values = chunk.values as ArrayLike<bigint | number> | null | undefined;
  if (!values) resultInvalid("The storage result payload is unreadable.");
  // Arrow `Data.slice` increments `Data.offset` for validity bits and also
  // subarrays numeric buffers, so `values` already starts at the logical row.
  const value = values[rowIndex];
  if (typeof value === "bigint" || typeof value === "number") return value;
  resultInvalid("The storage result contains an invalid temporal value.");
}

function decodeBatch(
  arrow: ArrowModule,
  schemaBytes: Uint8Array,
  batchBytes: Uint8Array,
  columns: readonly WarehouseQueryColumn[],
): { table: Table; rowCount: bigint } {
  let table: Table;
  try {
    table = arrow.tableFromIPC([schemaBytes, batchBytes]);
  } catch {
    resultInvalid("The storage result payload is unreadable.");
  }
  assertArrowSchema(arrow, table.schema.fields, columns);
  return { table, rowCount: BigInt(table.numRows) };
}

/** Materializes at most the rows this page still needs from an already-counted batch. */
function materializeRows(
  arrow: ArrowModule,
  table: Table,
  columns: readonly WarehouseQueryColumn[],
  count: number,
  budget: NestedBudget,
): unknown[][] {
  const vectors = Array.from({ length: table.numCols }, (_, index) =>
    table.getChildAt(index),
  );
  return Array.from({ length: count }, (_, rowIndex) =>
    vectors.map((vector, columnIndex) => {
      const field = table.schema.fields[columnIndex];
      const column = columns[columnIndex];
      if (!vector || !field || !column)
        resultInvalid("The storage result payload is unreadable.");
      return decodeCell(arrow, vector, rowIndex, field.type, column, budget, 0);
    }),
  );
}

/**
 * Waits for a local release operation only within an explicit budget. A release
 * that never settles is a leaked resource, not a success or an unbounded wait.
 */
export async function releaseWithinBudget(
  action: () => void | Promise<void>,
  timeoutMs: number = WAREHOUSE_STORAGE_CLEANUP_TIMEOUT_MS,
): Promise<"released" | "failed" | "timeout"> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) return "timeout";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const attempt = (async (): Promise<"released" | "failed"> => {
    try {
      await action();
      return "released";
    } catch {
      return "failed";
    }
  })();
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function releaseStream(
  stream: StorageReadRowsStream,
  iterator?: AsyncIterator<StorageReadRowsResponse>,
): Promise<string[]> {
  const failures: string[] = [];
  const deadline = Date.now() + WAREHOUSE_STORAGE_CLEANUP_TIMEOUT_MS;
  const release = async (
    label: string,
    action: () => void | Promise<void>,
  ): Promise<void> => {
    const remaining = deadline - Date.now();
    const outcome =
      remaining > 0
        ? await releaseWithinBudget(action, remaining)
        : ("timeout" as const);
    if (outcome !== "released")
      failures.push(outcome === "timeout" ? `${label}_timeout` : label);
  };
  await release("stream_cancel", () => stream.cancel?.());
  await release("stream_destroy", () => stream.destroy());
  if (iterator)
    await release("stream_return", async () => {
      await iterator.return?.();
    });
  return failures;
}

function streamTimeoutError(): Error {
  return Object.assign(new Error("The query result stream timed out."), {
    actionContractError: true,
    errorCode: "warehouse_query_timeout",
    statusCode: 502,
  });
}

/**
 * Reads one bounded page of a completed query job's Arrow results. The request
 * offset is an exact int64 string; the stream is destroyed as soon as the page
 * is satisfied so a small first page never drains a large result. A short
 * stream, an oversized batch or byte payload, a type/schema mismatch, or a row
 * count that disagrees with the completed job fails instead of being reported
 * as an empty or complete result.
 */
export async function readStoragePage(
  reader: WarehouseStorageReader,
  request: WarehouseStoragePageRequest,
): Promise<{ rows: unknown[][] }> {
  if (
    !Number.isSafeInteger(request.first) ||
    request.first < 1 ||
    request.first > WAREHOUSE_STORAGE_MAX_PAGE_ROWS
  )
    fail("The query page size is invalid.", {
      errorCode: "warehouse_query_page_invalid",
      statusCode: 422,
    });
  if (request.offset < 0n)
    fail("The query result cursor is invalid.", {
      errorCode: "warehouse_query_cursor_invalid",
      statusCode: 422,
    });
  const remaining = request.totalRows - request.offset;
  if (remaining < 0n)
    fail("The query result cursor is invalid.", {
      errorCode: "warehouse_query_cursor_invalid",
      statusCode: 422,
    });
  if (remaining === 0n) {
    if (request.offset > 0n)
      fail("The query result cursor is invalid.", {
        errorCode: "warehouse_query_cursor_invalid",
        statusCode: 422,
      });
    return { rows: [] };
  }
  const arrow = await loadArrow();
  const expectedPage =
    remaining < BigInt(request.first) ? remaining : BigInt(request.first);
  const readToEnd = expectedPage === remaining;
  const stream = reader.readRows(
    {
      readStream: warehouseJobStreamName(request),
      offset: request.offset.toString(),
    },
    { timeout: WAREHOUSE_STORAGE_READ_TIMEOUT_MS },
  );
  let schemaBytes: Uint8Array | undefined;
  let receivedRows = 0n;
  let estimatedRows: bigint | null = null;
  let receivedBytes = 0;
  let brokeEarly = false;
  let primary: unknown;
  const rows: unknown[][] = [];
  const budget: NestedBudget = { nested: 0 };
  let iterator: AsyncIterator<StorageReadRowsResponse>;
  try {
    iterator = stream[Symbol.asyncIterator]();
  } catch (error) {
    await releaseStream(stream);
    throw error;
  }
  const timerCleanupFailures: string[] = [];
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    deadline = setTimeout(() => {
      try {
        stream.cancel?.();
      } catch {
        timerCleanupFailures.push("stream_cancel");
      }
      try {
        stream.destroy(new Error("The query result stream timed out."));
      } catch {
        timerCleanupFailures.push("stream_destroy");
      }
      reject(streamTimeoutError());
    }, WAREHOUSE_STORAGE_READ_TIMEOUT_MS);
  });
  // The timeout may lose the race to a completing read; avoid an unhandled
  // rejection without changing the race outcome.
  void timeout.catch(() => {});
  const acceptBytes = (bytes: Uint8Array): void => {
    if (bytes.length > WAREHOUSE_STORAGE_MAX_RESPONSE_BYTES)
      resultInvalid("The storage result payload exceeds the supported size.");
    receivedBytes += bytes.length;
    if (receivedBytes > WAREHOUSE_STORAGE_MAX_RESULT_BYTES)
      resultInvalid("The storage result exceeds the supported size.");
  };
  try {
    while (true) {
      const pending = iterator.next();
      // If the timeout wins, the abandoned read may settle later; the timeout
      // is the reported outcome.
      void pending.catch(() => {});
      const next = await Promise.race([pending, timeout]);
      if (next.done) break;
      const response = next.value;
      if (response.arrowSchema?.serializedSchema) {
        const bytes = asBytes(response.arrowSchema.serializedSchema);
        acceptBytes(bytes);
        if (schemaBytes && !sameBytes(schemaBytes, bytes))
          resultInvalid("The storage result schema changed mid-stream.");
        schemaBytes = bytes;
      }
      const batchBytes = response.arrowRecordBatch?.serializedRecordBatch;
      const declaredRows =
        exactCount(response.rowCount) ??
        exactCount(response.arrowRecordBatch?.rowCount);
      if (!batchBytes) {
        if (declaredRows !== null && declaredRows > 0n)
          resultInvalid("The storage result is missing a record batch.");
        continue;
      }
      if (!schemaBytes)
        resultInvalid("The storage result sent rows before its schema.");
      const bytes = asBytes(batchBytes);
      acceptBytes(bytes);
      const decoded = decodeBatch(arrow, schemaBytes, bytes, request.columns);
      // The whole received batch counts against the job, even when this page
      // stops before the stream ends.
      if (receivedRows + decoded.rowCount > remaining)
        resultInvalid("The storage result returned more rows than the job.");
      if (declaredRows !== null && declaredRows !== decoded.rowCount)
        resultInvalid("The storage result row count does not match its rows.");
      if (declaredRows === null)
        resultInvalid("The storage result did not declare its row count.");
      const needed = Number(expectedPage - BigInt(rows.length));
      const take = Number(
        decoded.rowCount < BigInt(needed) ? decoded.rowCount : BigInt(needed),
      );
      if (take > 0)
        rows.push(
          ...materializeRows(
            arrow,
            decoded.table,
            request.columns,
            take,
            budget,
          ),
        );
      receivedRows += decoded.rowCount;
      const estimated = exactCount(response.totalEstimatedRowCount);
      if (estimated !== null) {
        if (estimatedRows !== null && estimatedRows !== estimated)
          resultInvalid("The storage result row estimate changed mid-stream.");
        estimatedRows = estimated;
      }
      if (!readToEnd && BigInt(rows.length) >= expectedPage) {
        brokeEarly = true;
        break;
      }
    }
    if (brokeEarly) {
      if (receivedRows < expectedPage)
        resultInvalid("The storage result is incomplete.");
    } else if (receivedRows !== remaining)
      resultInvalid("The storage result is incomplete.");
    if (estimatedRows !== null && estimatedRows !== request.totalRows)
      resultInvalid(
        "The storage result row count does not match the query job.",
      );
  } catch (error) {
    primary = error;
  }
  clearTimeout(deadline);

  const cleanupFailures = [
    ...timerCleanupFailures,
    ...(await releaseStream(stream, iterator)),
  ];

  if (primary !== undefined)
    throw normalizeStorageReadFailure(primary, {
      storagePhase: "read_rows",
      ...(cleanupFailures.length ? { unreleasedStorageStream: true } : {}),
    });
  if (cleanupFailures.length)
    fail("The query result could not be closed cleanly. Retry the query.", {
      errorCode: "warehouse_query_cleanup_failed",
      statusCode: 502,
      details: { unreleasedStorageStream: true },
    });
  return { rows: rows.slice(0, Number(expectedPage)) };
}

export interface WarehouseServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

export type WarehouseStorageClient =
  import("@google-cloud/bigquery-storage").BigQueryReadClient;

export interface WarehouseStorageHandle extends WarehouseStorageReader {
  client: WarehouseStorageClient;
}

type StorageReadClientOptions = NonNullable<
  ConstructorParameters<
    typeof import("@google-cloud/bigquery-storage").BigQueryReadClient
  >[0]
> & {
  "grpc.max_receive_message_length"?: number;
  "grpc.max_send_message_length"?: number;
};

/**
 * Creates the official Storage client from an already-selected service account
 * and an explicit scope list. Passing `credentials` keeps google-auth-library
 * on that key instead of ADC or an environment credential file; the credential
 * object is rebuilt so a stored `type` or `token_uri` cannot redirect auth.
 * google-gax disables the gRPC receive limit by default, so the client sets an
 * explicit message bound in addition to the per-page byte checks.
 */
export async function createWarehouseStorageClient(
  credential: WarehouseServiceAccount,
  scopes: readonly string[],
): Promise<WarehouseStorageHandle> {
  const { BigQueryReadClient } = await import("@google-cloud/bigquery-storage");
  const options: StorageReadClientOptions = {
    credentials: {
      type: "service_account",
      client_email: credential.client_email,
      private_key: credential.private_key,
      project_id: credential.project_id,
    },
    scopes: [...scopes],
    projectId: credential.project_id,
    "grpc.max_receive_message_length": WAREHOUSE_STORAGE_MAX_RESPONSE_BYTES,
    "grpc.max_send_message_length": 1_048_576,
  };
  const client = new BigQueryReadClient(options);
  return {
    client,
    readRows: (request, options) =>
      client.readRows(request, options) as unknown as StorageReadRowsStream,
    close: () => client.close(),
  };
}
