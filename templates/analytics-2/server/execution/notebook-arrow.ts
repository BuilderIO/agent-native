import { createHash, randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import {
  deletePrivateBlob,
  putPrivateBlob,
  readPrivateBlob,
} from "@agent-native/core/private-blob";
import {
  Binary,
  Bool,
  DataType,
  DateDay,
  Decimal,
  Field,
  Float64,
  Int64,
  Null,
  RecordBatch,
  Schema,
  TimeUnit,
  TimestampMicrosecond,
  TimeMicrosecond,
  Utf8,
  Table,
  Vector,
  makeData,
  makeVector,
  tableFromIPC,
  tableToIPC,
  vectorFromArray,
} from "apache-arrow";
import { z } from "zod";

import enUS from "../../app/i18n/en-US.js";
import { decimalText } from "../../shared/arrow-decimal.js";
import {
  resultFieldSchema,
  type ResultField,
} from "../../shared/notebook-result-contract.js";
import type { notebookResultSegments } from "../model/notebook-execution/schema.js";
import { notebookResultBlobPurpose } from "./local-notebook-blob.js";

export const RESULT_SEGMENT_ROWS = 1000;
export const MAX_RESULT_SEGMENTS = 4096;
export const MAX_KERNEL_ARROW_BYTES = 32 * 1024 * 1024;
const MAX_SEGMENT_BYTES = 16 * 1024 * 1024;
const MAX_LEGACY_SEGMENT_ROWS = 10_000;

type Column = {
  name: string;
  type: string;
  mode?: string | undefined;
  decimal?: Decimal;
};
export type NotebookRows = { columns: Column[]; rows: unknown[][] };
export type StagedSegment = typeof notebookResultSegments.$inferInsert;

export function notebookResultFields(columns: Column[]) {
  const fields = columns.map(({ name, type, mode }, index) =>
    resultFieldSchema.parse({
      fieldId: String(index),
      name,
      type: mode === "REPEATED" ? "list" : resultType(type),
      nullable: mode !== "REQUIRED",
    }),
  );
  if (JSON.stringify(fields).length > 100_000)
    throw new Error("Notebook result schema is too large");
  return fields;
}

function resultType(type: string): ResultField["type"] {
  switch (type.toUpperCase()) {
    case "INT64":
    case "INTEGER":
      return "integer";
    case "NUMERIC":
    case "BIGNUMERIC":
    case "DECIMAL":
    case "BIGDECIMAL":
      return "decimal";
    case "FLOAT64":
    case "FLOAT":
    case "NUMBER":
      return "number";
    case "BOOL":
    case "BOOLEAN":
      return "boolean";
    case "DATE":
      return "date";
    case "DATETIME":
    case "TIMESTAMP":
      return "datetime";
    case "NULL":
      return "null";
    case "STRING":
    case "GEOGRAPHY":
      return "string";
    case "TIME":
      return "time";
    case "BYTES":
      return "binary";
    case "JSON":
      return "json";
    case "STRUCT":
    case "RECORD":
      return "struct";
    default:
      throw new Error("Unsupported result field type");
  }
}

function scaledDecimal(value: string, scale: number) {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d{1,2}))?$/i.exec(value);
  if (!match) throw new Error("Unreadable decimal value");
  const fraction = match[3] ?? "";
  const exponent = scale + Number(match[4] ?? "0") - fraction.length;
  const coefficient = BigInt(`${match[1]}${match[2]}${fraction}`);
  if (exponent >= 0) return coefficient * 10n ** BigInt(exponent);
  const divisor = 10n ** BigInt(-exponent);
  if (coefficient % divisor !== 0n)
    throw new Error("Unreadable decimal precision");
  return coefficient / divisor;
}

function decimalWords(value: unknown, type: Decimal) {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("Unreadable decimal value");
  const decimal = scaledDecimal(value, type.scale);
  const bound = 10n ** BigInt(type.precision);
  if (decimal <= -bound || decimal >= bound)
    throw new Error("Unreadable decimal precision");
  const unsigned = BigInt.asUintN(type.bitWidth, decimal);
  return Uint32Array.from({ length: type.bitWidth / 32 }, (_value, index) =>
    Number((unsigned >> BigInt(32 * index)) & 0xffff_ffffn),
  );
}

function timestampMicros(value: unknown) {
  if (typeof value !== "string") throw new Error("Unreadable timestamp value");
  if (/^[+-]?\d+(?:\.\d+)?(?:e[+-]?\d{1,2})?$/i.test(value))
    return scaledDecimal(value, 6);
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})?$/.exec(
      value,
    );
  if (!match) throw new Error("Unreadable timestamp value");
  const seconds = Date.parse(`${match[1]}T${match[2]}${match[4] ?? "Z"}`);
  if (!Number.isFinite(seconds)) throw new Error("Unreadable timestamp value");
  return BigInt(seconds) * 1000n + BigInt((match[3] ?? "").padEnd(6, "0"));
}

function timeMicros(value: unknown) {
  if (typeof value !== "string") throw new Error("Unreadable time value");
  const match = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) throw new Error("Unreadable time value");
  return (
    BigInt(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) *
      1_000_000n +
    BigInt((match[4] ?? "").padEnd(6, "0"))
  );
}

function microsecondVector(
  values: unknown[],
  type: TimestampMicrosecond | TimeMicrosecond,
  read: (value: unknown) => bigint,
) {
  const nullBitmap = new Uint8Array(Math.ceil(values.length / 8));
  let nullCount = 0;
  const data = BigInt64Array.from(values, (value, index) => {
    if (value === null) {
      nullCount++;
      return 0n;
    }
    const byte = Math.floor(index / 8);
    nullBitmap[byte] = (nullBitmap[byte] ?? 0) | (1 << (index % 8));
    const ticks = read(value);
    if (BigInt.asIntN(64, ticks) !== ticks)
      throw new Error("Arrow temporal value is too large");
    return ticks;
  });
  const buffers = { data, length: values.length, nullBitmap, nullCount };
  return type instanceof TimeMicrosecond
    ? makeVector(makeData({ ...buffers, type }))
    : makeVector(makeData({ ...buffers, type }));
}

export function nameNotebookArrowColumns(table: Table, fields: ResultField[]) {
  const schema = new Schema(
    table.schema.fields.map((field, index) => {
      const column = fields[index];
      if (!column) throw new Error("Notebook result schema is unreadable");
      return new Field(
        column.name,
        field.type,
        column.nullable,
        field.metadata,
      );
    }),
  );
  return new Table(
    schema,
    table.batches.map(({ data }) => new RecordBatch(schema, data)),
  );
}

export function notebookTable(page: NotebookRows, fields: ResultField[]) {
  const vectors = fields.map((field, index) => {
    const values = page.rows.map((row) => row[index]);
    switch (field.type) {
      case "integer":
        return vectorFromArray(
          values.map((value) => {
            if (value === null) return null;
            if (
              typeof value === "bigint" ||
              (typeof value === "number" && Number.isSafeInteger(value)) ||
              (typeof value === "string" && /^-?\d+$/.test(value))
            ) {
              const integer = BigInt(value);
              if (BigInt.asIntN(64, integer) === integer) return integer;
            }
            throw new Error("Unreadable integer value");
          }),
          new Int64(),
        );
      case "number":
        return vectorFromArray(
          values.map((value) => {
            if (value === null) return null;
            if (typeof value === "number" && Number.isFinite(value))
              return value;
            if (
              typeof value === "string" &&
              value.trim() &&
              Number.isFinite(Number(value))
            )
              return Number(value);
            throw new Error("Unreadable numeric value");
          }),
          new Float64(),
        );
      case "boolean":
        return vectorFromArray(
          values.map((value) => {
            if (value === null) return null;
            if (value === true || value === "true") return true;
            if (value === false || value === "false") return false;
            throw new Error("Unreadable boolean value");
          }),
          new Bool(),
        );
      case "binary":
        return vectorFromArray(
          values.map((value) => {
            if (value === null || value instanceof Uint8Array) return value;
            if (typeof value === "string") return Buffer.from(value, "base64");
            throw new Error("Unreadable binary value");
          }),
          new Binary(),
        );
      case "list":
      case "struct":
      case "json":
        return vectorFromArray(
          values.map((value) =>
            value === null ? null : JSON.stringify(z.json().parse(value)),
          ),
          new Utf8(),
        );
      case "date":
        return vectorFromArray(
          values.map((value) => {
            if (value === null) return null;
            if (
              typeof value !== "string" ||
              !z.iso.date().safeParse(value).success
            )
              throw new Error("Unreadable date value");
            return new Date(`${value}T00:00:00Z`);
          }),
          new DateDay(),
        );
      case "datetime":
        return microsecondVector(
          values,
          new TimestampMicrosecond(
            page.columns[index]?.type.toUpperCase() === "DATETIME"
              ? null
              : "UTC",
          ),
          timestampMicros,
        );
      case "decimal": {
        const big = /^(?:BIGNUMERIC|BIGDECIMAL)$/i.test(
          page.columns[index]?.type ?? "",
        );
        const type =
          page.columns[index]?.decimal ??
          (big ? new Decimal(38, 76, 256) : new Decimal(9, 38));
        return vectorFromArray(
          values.map((value) => decimalWords(value, type)),
          type,
        );
      }
      case "time":
        return microsecondVector(values, new TimeMicrosecond(), timeMicros);
      case "null":
        if (values.some((value) => value !== null))
          throw new Error("Unreadable null value");
        return vectorFromArray(values, new Null());
      case "string":
        return vectorFromArray(
          values.map((value) => {
            if (value === null || typeof value === "string") return value;
            throw new Error("Unreadable text value");
          }),
          new Utf8(),
        );
    }
  });
  return nameNotebookArrowColumns(
    new Table(
      Object.fromEntries(
        vectors.map((vector, index) => [String(index), vector]),
      ),
    ),
    fields,
  );
}

function kernelFieldType(type: DataType): ResultField["type"] {
  if (DataType.isDictionary(type)) return kernelFieldType(type.dictionary);
  if (DataType.isInt(type)) return "integer";
  if (DataType.isFloat(type)) return "number";
  if (DataType.isBool(type)) return "boolean";
  if (DataType.isDecimal(type)) return "decimal";
  if (DataType.isDate(type)) return "date";
  if (DataType.isTimestamp(type)) return "datetime";
  if (DataType.isTime(type)) return "time";
  if (DataType.isNull(type)) return "null";
  if (
    DataType.isList(type) ||
    DataType.isLargeList(type) ||
    DataType.isFixedSizeList(type)
  )
    return "list";
  if (DataType.isStruct(type) || DataType.isMap(type)) return "struct";
  if (
    DataType.isBinary(type) ||
    DataType.isLargeBinary(type) ||
    DataType.isFixedSizeBinary(type)
  )
    return "binary";
  if (DataType.isUtf8(type) || DataType.isLargeUtf8(type)) return "string";
  throw new Error(`Unsupported notebook Arrow type: ${type}`);
}

export function kernelArrowTable(bytes: Uint8Array) {
  if (bytes.length > MAX_KERNEL_ARROW_BYTES)
    throw new Error("Notebook Arrow artifact is too large");
  const table = tableFromIPC(bytes);
  const fields = table.schema.fields.map((field, index) =>
    resultFieldSchema.parse({
      fieldId: String(index),
      name: field.name,
      type: kernelFieldType(field.type),
      nullable: field.nullable,
    }),
  );
  if (JSON.stringify(fields).length > 100_000)
    throw new Error("Notebook result schema is too large");
  return { table, fields };
}

function rawTicks(vector: Vector, index: number) {
  for (const chunk of vector.data) {
    if (index >= chunk.length) {
      index -= chunk.length;
      continue;
    }
    const value: unknown = chunk.values[index];
    if (typeof value === "bigint" || typeof value === "number")
      return BigInt(value);
    break;
  }
  throw new Error("Unreadable Arrow temporal value");
}

function temporalText(
  ticks: bigint,
  unit: TimeUnit,
  zoned: boolean,
  timeOnly: boolean,
) {
  const digits = [0, 3, 6, 9][unit];
  if (digits === undefined) throw new Error("Unsupported Arrow temporal unit");
  const resolution = 10n ** BigInt(digits);
  const fraction = ((ticks % resolution) + resolution) % resolution;
  const start = new Date(
    Number((ticks - fraction) / resolution) * 1000,
  ).toISOString();
  const prefix = timeOnly ? start.slice(11, 19) : start.replace(/\.000Z$/, "");
  return `${prefix}${fraction ? `.${fraction.toString().padStart(digits, "0").replace(/0+$/, "")}` : ""}${zoned ? "Z" : ""}`;
}

export function notebookArrowValue(
  vector: Vector,
  index: number,
  preserveDecimalScale = false,
): unknown {
  const value: unknown = vector.get(index);
  if (value === null) return null;
  const type = vector.type;
  if (DataType.isDecimal(type)) {
    if (!(value instanceof Uint32Array))
      throw new Error("Unreadable Arrow decimal");
    return decimalText(value, type.scale, preserveDecimalScale);
  }
  if (DataType.isDate(type) && typeof value === "number")
    return new Date(value).toISOString().slice(0, 10);
  if (DataType.isTimestamp(type))
    return temporalText(
      rawTicks(vector, index),
      type.unit,
      Boolean(type.timezone),
      false,
    );
  if (DataType.isTime(type))
    return temporalText(rawTicks(vector, index), type.unit, false, true);
  if (DataType.isInt(type) && typeof value === "number") return BigInt(value);
  if (value instanceof Vector)
    return Array.from({ length: value.length }, (_, item) =>
      notebookArrowValue(value, item, preserveDecimalScale),
    );
  if (DataType.isStruct(type))
    return Object.fromEntries(
      type.children.map(({ name }, child) => {
        const column = vector.getChildAt(child);
        if (!column) throw new Error("Unreadable Arrow struct");
        return [name, notebookArrowValue(column, index, preserveDecimalScale)];
      }),
    );
  return value;
}

export function notebookArrowRows(
  table: Table,
  fields: ResultField[],
): NotebookRows {
  const vectors = fields.map((_field, index) => {
    const vector = table.getChildAt(index);
    if (!vector) throw new Error("Notebook result is missing a column");
    return vector;
  });
  return {
    columns: fields.map(({ name, type, nullable }) => ({
      name,
      type,
      mode: nullable ? "NULLABLE" : "REQUIRED",
    })),
    rows: Array.from({ length: table.numRows }, (_, row) =>
      vectors.map((vector) => notebookArrowValue(vector, row)),
    ),
  };
}

export function kernelInputTable(table: Table, fields: ResultField[]) {
  if (
    table.schema.fields.every(
      (field, index) => field.name === fields[index]?.name,
    )
  )
    return table;
  if (
    !table.schema.fields.every((field, index) => field.name === String(index))
  )
    throw new Error("Notebook result columns differ from their manifest");
  return notebookTable(notebookArrowRows(table, fields), fields);
}

function sampleInputFields(fields: ResultField[]) {
  const names = new Set(fields.map(({ name }) => name));
  if (names.size === fields.length) return fields;
  const seen = new Set<string>();
  return fields.map((field) => {
    if (!seen.has(field.name)) {
      seen.add(field.name);
      return field;
    }
    let suffix = 2;
    while (names.has(`${field.name}_${suffix}`)) suffix++;
    const name = `${field.name}_${suffix}`;
    names.add(name);
    return { ...field, name };
  });
}

export function kernelInputBytes(
  tables: Table[],
  fields: ResultField[],
  preserveSampleAliases: boolean,
) {
  const first = tables[0];
  const table = first
    ? new Table(
        first.schema,
        tables.flatMap(({ batches }) => batches),
      )
    : notebookTable({ columns: fields, rows: [] }, fields);
  const inputFields = preserveSampleAliases
    ? sampleInputFields(fields)
    : fields;
  const bytes = tableToIPC(
    inputFields === fields
      ? table
      : nameNotebookArrowColumns(table, inputFields),
  );
  if (bytes.length > MAX_KERNEL_ARROW_BYTES)
    throw new Error("Notebook input exceeds the kernel Arrow limit");
  return bytes;
}

function checksum(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function decodeNotebookArrow(
  bytes: Uint8Array,
  fields: ResultField[],
  expectedRows?: number,
) {
  if (bytes.length > MAX_SEGMENT_BYTES)
    throw new Error("Result segment is too large");
  const table = tableFromIPC(bytes);
  if (
    table.numCols !== fields.length ||
    (expectedRows !== undefined && table.numRows !== expectedRows) ||
    table.numRows > (expectedRows ?? MAX_LEGACY_SEGMENT_ROWS)
  )
    throw new Error("Result segment shape differs from its index");
  return table;
}

export async function readNotebookSegment(
  segment: Pick<StagedSegment, "handle" | "checksum" | "rowCount">,
  fields: ResultField[],
) {
  const { data } = await readPrivateBlob(segment.handle);
  if (checksum(data) !== segment.checksum)
    throw new Error("Result segment digest differs from its index");
  return { data, table: decodeNotebookArrow(data, fields, segment.rowCount) };
}

export async function stageNotebookSegment(
  input: {
    artifactId: string;
    attemptId: string;
    submissionId: string;
    ownerEmail: string;
    startRow: number;
    page: NotebookRows;
    fields: ResultField[];
  },
  record: (segment: StagedSegment) => Promise<boolean>,
) {
  if (input.page.rows.some((row) => row.length !== input.fields.length))
    throw new Error("Notebook result row shape is invalid");
  await stageNotebookArrowSegment(
    { ...input, table: notebookTable(input.page, input.fields) },
    record,
  );
}

export async function stageNotebookArrowSegment(
  input: {
    artifactId: string;
    attemptId: string;
    submissionId: string;
    ownerEmail: string;
    startRow: number;
    table: Table;
    fields: ResultField[];
  },
  record: (segment: StagedSegment) => Promise<boolean>,
) {
  const {
    artifactId,
    attemptId,
    submissionId,
    ownerEmail,
    startRow,
    table,
    fields,
  } = input;
  if (
    !Number.isSafeInteger(startRow) ||
    startRow < 0 ||
    !table.numRows ||
    table.numRows > RESULT_SEGMENT_ROWS ||
    !fields.length ||
    table.numCols !== fields.length ||
    fields.some(
      (field, index) =>
        !field.nullable && table.getChildAt(index)?.nullCount !== 0,
    )
  )
    throw new Error("Notebook result row range or shape is invalid");
  const data = tableToIPC(table);
  decodeNotebookArrow(data, fields, table.numRows);
  const handle = await putPrivateBlob({
    ownerEmail,
    key: `notebook-results/${artifactId}/${startRow}/${attemptId}/${randomUUID()}`,
    data,
    mimeType: "application/vnd.apache.arrow.stream",
    metadata: { purpose: notebookResultBlobPurpose },
  });
  if (!handle)
    fail(enUS.queryError.resultStorageUnavailable, {
      errorCode: "notebook_result_storage_unavailable",
      statusCode: 503,
    });
  const segment = {
    submissionId,
    artifactId,
    startRow,
    rowCount: table.numRows,
    handle,
    checksum: checksum(data),
    createdAt: Date.now(),
  };
  let verified = false;
  try {
    await readNotebookSegment(segment, fields);
    verified = true;
  } finally {
    if (!(await record({ ...segment, verified }))) {
      const removed = await deletePrivateBlob(handle);
      if (!removed.deleted)
        throw new Error("Could not remove an unclaimed result segment");
    }
  }
}
