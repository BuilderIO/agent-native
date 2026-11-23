import { tableFromIPC } from "apache-arrow";

import type { ChartSpec } from "../../app/lib/model/contracts.js";
import { chartMeasureFieldIds } from "../../shared/chart-visualization-config.js";
import type { MetricConfig } from "../../shared/metric-config.js";
import type {
  CompleteResultManifest,
  ResultField,
} from "../../shared/notebook-result-contract.js";
import type { PivotConfigV2, PivotScalar } from "../../shared/pivot-config.js";
import type {
  TableConfig,
  TableFilter,
} from "../../shared/table-visualization-config.js";
import { notebookArrowValue } from "./notebook-arrow.js";
import { joinVisualizationArrow } from "./visualization-kernel.js";
import {
  numberField,
  VISUALIZATION_GROUP_LIMIT,
  VisualizationBindingError,
} from "./visualization-sql.js";

const PAGE_SIZE = 50;
const GROUP_PROBE = VISUALIZATION_GROUP_LIMIT + 1;
const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

type Aggregation =
  | PivotConfigV2["values"][number]["aggregation"]
  | NonNullable<ChartSpec["yAggregation"]>;
type Sort = NonNullable<TableConfig["sort"]>;
type TimeBucket = Exclude<ChartSpec["xTimeUnit"], "none" | undefined>;
type DecimalValue = { coeff: bigint; scale: number; text: string };
type TypedValue =
  | number
  | bigint
  | DecimalValue
  | boolean
  | string
  | Uint8Array
  | null;
type ResolvedField = { field: ResultField; index: number };

function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = i + 1 < len ? (bytes[i + 1] ?? 0) : 0;
    const b2 = i + 2 < len ? (bytes[i + 2] ?? 0) : 0;
    out += BASE64_CHARS[b0 >> 2];
    out += BASE64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < len ? BASE64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < len ? BASE64_CHARS[b2 & 63] : "=";
  }
  return out;
}

function formatDecimal(coeff: bigint, scale: number): string {
  const neg = coeff < 0n;
  const abs = neg ? -coeff : coeff;
  const str = abs.toString();
  if (scale === 0) return `${neg ? "-" : ""}${str}`;
  const padded = str.padStart(scale + 1, "0");
  return `${neg ? "-" : ""}${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

function parseDecimal(raw: string): DecimalValue {
  const trimmed = raw.trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(trimmed);
  if (!match)
    throw new VisualizationBindingError(
      "Filter value does not match the result field",
    );
  const sign = match[1] === "-" ? "-" : "";
  const intPart = match[2] ?? "0";
  const fracPart = match[3] ?? "";
  const exp = Number(match[4] ?? "0");
  let coeff = BigInt(`${sign}${intPart}${fracPart}`);
  let scale = fracPart.length - exp;
  if (scale < 0) {
    coeff = coeff * 10n ** BigInt(-scale);
    scale = 0;
  }
  while (scale > 0 && coeff % 10n === 0n) {
    coeff /= 10n;
    scale--;
  }
  if (coeff === 0n) scale = 0;
  return { coeff, scale, text: formatDecimal(coeff, scale) };
}

function parseDateMs(raw: string): number {
  const trimmed = raw.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/.exec(trimmed);
  if (!match)
    throw new VisualizationBindingError(
      "Filter value does not match the result field",
    );
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const ms = Date.UTC(y, m - 1, d);
  const check = new Date(ms);
  if (
    !Number.isFinite(ms) ||
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d
  )
    throw new VisualizationBindingError(
      "Filter value does not match the result field",
    );
  return ms;
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function parseTimestampMicros(raw: string): bigint {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed))
    return BigInt(parseDateMs(trimmed)) * 1000n;
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      trimmed,
    );
  if (!match)
    throw new VisualizationBindingError(
      "Filter value does not match the result field",
    );
  const tzRaw = match[4] ?? "Z";
  const tz =
    tzRaw.length === 5 && (tzRaw[0] === "+" || tzRaw[0] === "-")
      ? `${tzRaw.slice(0, 3)}:${tzRaw.slice(3)}`
      : tzRaw.toUpperCase();
  const secondsMs = Date.parse(`${match[1]}T${match[2]}${tz}`);
  if (!Number.isFinite(secondsMs))
    throw new VisualizationBindingError(
      "Filter value does not match the result field",
    );
  const fracStr = (match[3] ?? "").slice(0, 6).padEnd(6, "0");
  return BigInt(secondsMs) * 1000n + BigInt(fracStr);
}

function formatTimestamp(micros: bigint): string {
  const res = 1_000_000n;
  const frac = ((micros % res) + res) % res;
  const sec = (micros - frac) / res;
  const iso = new Date(Number(sec) * 1000).toISOString();
  const base = iso.replace("T", " ").replace(/\.000Z$/, "");
  if (frac === 0n) return base;
  return `${base}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

function parseTimeMicros(raw: string): bigint {
  const match = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/.exec(raw.trim());
  if (!match)
    throw new VisualizationBindingError(
      "Filter value does not match the result field",
    );
  const h = Number(match[1]);
  const m = Number(match[2]);
  const s = Number(match[3]);
  const frac = (match[4] ?? "").slice(0, 6).padEnd(6, "0");
  return BigInt(h * 3600 + m * 60 + s) * 1_000_000n + BigInt(frac);
}

function formatTime(micros: bigint): string {
  const res = 1_000_000n;
  const frac = ((micros % res) + res) % res;
  const totalSec = Number((micros - frac) / res);
  const h = Math.floor(totalSec / 3600) % 24;
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const base = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  if (frac === 0n) return base;
  return `${base}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

function truncateDateMs(ms: number, unit: TimeBucket): number {
  const d = new Date(ms);
  switch (unit) {
    case "year":
      return Date.UTC(d.getUTCFullYear(), 0, 1);
    case "quarter":
      return Date.UTC(
        d.getUTCFullYear(),
        Math.floor(d.getUTCMonth() / 3) * 3,
        1,
      );
    case "month":
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    case "week": {
      const daysSinceMonday = (d.getUTCDay() + 6) % 7;
      return Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate() - daysSinceMonday,
      );
    }
    case "day":
    case "hour":
    case "minute":
    case "second":
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
}

function truncateTimestampMicros(micros: bigint, unit: TimeBucket): bigint {
  const res = 1_000_000n;
  const frac = ((micros % res) + res) % res;
  const sec = Number((micros - frac) / res);
  const d = new Date(sec * 1000);
  switch (unit) {
    case "year":
      return BigInt(Date.UTC(d.getUTCFullYear(), 0, 1)) * 1000n;
    case "quarter":
      return (
        BigInt(
          Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1),
        ) * 1000n
      );
    case "month":
      return BigInt(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)) * 1000n;
    case "week": {
      const daysSinceMonday = (d.getUTCDay() + 6) % 7;
      return (
        BigInt(
          Date.UTC(
            d.getUTCFullYear(),
            d.getUTCMonth(),
            d.getUTCDate() - daysSinceMonday,
          ),
        ) * 1000n
      );
    }
    case "day":
      return (
        BigInt(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) *
        1000n
      );
    case "hour":
      return (
        BigInt(
          Date.UTC(
            d.getUTCFullYear(),
            d.getUTCMonth(),
            d.getUTCDate(),
            d.getUTCHours(),
          ),
        ) * 1000n
      );
    case "minute":
      return (
        BigInt(
          Date.UTC(
            d.getUTCFullYear(),
            d.getUTCMonth(),
            d.getUTCDate(),
            d.getUTCHours(),
            d.getUTCMinutes(),
          ),
        ) * 1000n
      );
    case "second":
      return micros - frac;
  }
}

function stringifyComposite(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}

function coerceArrowCell(raw: unknown, field: ResultField): TypedValue {
  if (raw === null || raw === undefined) return null;
  switch (field.type) {
    case "number": {
      const n =
        typeof raw === "number"
          ? raw
          : typeof raw === "bigint"
            ? Number(raw)
            : Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case "integer":
      if (typeof raw === "bigint") return raw;
      if (typeof raw === "number" && Number.isSafeInteger(raw))
        return BigInt(raw);
      if (typeof raw === "string") return BigInt(raw.trim());
      throw new Error("Unreadable integer value");
    case "decimal":
      return parseDecimal(typeof raw === "string" ? raw : String(raw));
    case "boolean":
      if (typeof raw === "boolean") return raw;
      if (raw === "true") return true;
      if (raw === "false") return false;
      throw new Error("Unreadable boolean value");
    case "date":
      if (raw instanceof Date) return parseDateMs(raw.toISOString());
      if (typeof raw === "number")
        return parseDateMs(new Date(raw).toISOString());
      if (typeof raw === "string") return parseDateMs(raw);
      throw new Error("Unreadable date value");
    case "datetime":
      if (raw instanceof Date) return BigInt(raw.getTime()) * 1000n;
      if (typeof raw === "string") return parseTimestampMicros(raw);
      throw new Error("Unreadable datetime value");
    case "time":
      if (typeof raw === "string") return parseTimeMicros(raw);
      throw new Error("Unreadable time value");
    case "binary":
      if (raw instanceof Uint8Array) return raw;
      throw new Error("Unreadable binary value");
    case "null":
      return null;
    case "string":
      return typeof raw === "string" ? raw : String(raw);
    case "json":
    case "list":
    case "struct":
      return typeof raw === "string" ? raw : stringifyComposite(raw);
  }
}

function parseFilterLiteral(
  value: PivotScalar,
  field: ResultField,
): TypedValue {
  if (value === null) return null;
  if (
    field.type === "number" &&
    typeof value === "number" &&
    Number.isFinite(value)
  )
    return value;
  if (field.type === "boolean" && typeof value === "boolean") return value;
  if (
    field.type === "integer" &&
    typeof value === "number" &&
    Number.isSafeInteger(value)
  )
    return BigInt(value);
  if (
    typeof value === "string" &&
    field.type !== "number" &&
    field.type !== "boolean" &&
    field.type !== "binary"
  ) {
    switch (field.type) {
      case "integer": {
        const trimmed = value.trim();
        if (!/^-?\d+$/.test(trimmed))
          throw new VisualizationBindingError(
            "Filter value does not match the result field",
          );
        return BigInt(trimmed);
      }
      case "decimal":
        return parseDecimal(value);
      case "date":
        return parseDateMs(value);
      case "datetime":
        return parseTimestampMicros(value);
      case "time":
        return parseTimeMicros(value);
      case "null":
      case "string":
      case "json":
      case "list":
      case "struct":
        return value;
    }
  }
  throw new VisualizationBindingError(
    "Filter value does not match the result field",
  );
}

function compareNonNull(
  a: Exclude<TypedValue, null>,
  b: Exclude<TypedValue, null>,
  type: ResultField["type"],
): number {
  switch (type) {
    case "number":
    case "date": {
      const left = a as number;
      const right = b as number;
      return left < right ? -1 : left > right ? 1 : 0;
    }
    case "integer":
    case "datetime":
    case "time": {
      const left = a as bigint;
      const right = b as bigint;
      return left < right ? -1 : left > right ? 1 : 0;
    }
    case "decimal": {
      const left = a as DecimalValue;
      const right = b as DecimalValue;
      const maxScale = Math.max(left.scale, right.scale);
      const l = left.coeff * 10n ** BigInt(maxScale - left.scale);
      const r = right.coeff * 10n ** BigInt(maxScale - right.scale);
      return l < r ? -1 : l > r ? 1 : 0;
    }
    case "boolean":
      return Number(a as boolean) - Number(b as boolean);
    case "binary": {
      const left = a as Uint8Array;
      const right = b as Uint8Array;
      const minLen = Math.min(left.length, right.length);
      for (let i = 0; i < minLen; i++) {
        const diff = (left[i] ?? 0) - (right[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return left.length - right.length;
    }
    case "string":
    case "json":
    case "list":
    case "struct":
    case "null": {
      const left = a as string;
      const right = b as string;
      return left < right ? -1 : left > right ? 1 : 0;
    }
  }
}

function compareNullsFirst(
  a: TypedValue,
  b: TypedValue,
  type: ResultField["type"],
): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return compareNonNull(a, b, type);
}

function compareNullsLast(
  a: TypedValue,
  b: TypedValue,
  type: ResultField["type"],
  direction: "asc" | "desc",
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const cmp = compareNonNull(a, b, type);
  return direction === "asc" ? cmp : -cmp;
}

function typedKey(value: TypedValue, type: ResultField["type"]): string {
  if (value === null) return "N";
  switch (type) {
    case "number": {
      const n = value as number;
      return `D:${Object.is(n, -0) ? 0 : n}`;
    }
    case "integer":
      return `I:${(value as bigint).toString()}`;
    case "decimal": {
      const d = value as DecimalValue;
      return `M:${d.coeff.toString()}:${d.scale}`;
    }
    case "boolean":
      return value ? "B:1" : "B:0";
    case "date":
      return `A:${value as number}`;
    case "datetime":
      return `T:${(value as bigint).toString()}`;
    case "time":
      return `H:${(value as bigint).toString()}`;
    case "binary":
      return `Y:${bytesToBase64(value as Uint8Array)}`;
    case "string":
    case "json":
    case "list":
    case "struct":
    case "null":
      return `S:${value as string}`;
  }
}

function displayValue(value: TypedValue, field: ResultField): PivotScalar {
  if (value === null) return null;
  switch (field.type) {
    case "binary":
      return bytesToBase64(value as Uint8Array);
    case "boolean":
      return value as boolean;
    case "number":
      return value as number;
    case "integer":
      return (value as bigint).toString();
    case "decimal":
      return (value as DecimalValue).text;
    case "date":
      return formatDate(value as number);
    case "datetime":
      return formatTimestamp(value as bigint);
    case "time":
      return formatTime(value as bigint);
    case "string":
    case "json":
    case "list":
    case "struct":
    case "null":
      return value as string;
  }
}

function toNumberValue(
  value: TypedValue,
  type: ResultField["type"],
): number | null {
  if (value === null) return null;
  switch (type) {
    case "number":
      return Number.isFinite(value as number) ? (value as number) : null;
    case "integer": {
      const n = Number(value as bigint);
      return Number.isFinite(n) ? n : null;
    }
    case "decimal": {
      const n = Number((value as DecimalValue).text);
      return Number.isFinite(n) ? n : null;
    }
    default:
      return null;
  }
}

function validateAggregate(field: ResultField, operation: Aggregation): void {
  if (
    operation === "count" ||
    operation === "count-distinct" ||
    operation === "distinct_count"
  )
    return;
  if (!numberField(field))
    throw new VisualizationBindingError(
      "This aggregate requires a number field",
    );
}

function computeAggregateNumber(
  rows: TypedValue[][],
  colIndex: number,
  field: ResultField,
  operation: Aggregation,
): number | null {
  if (operation === "count") {
    let count = 0;
    for (const row of rows) {
      if (row[colIndex] !== null) count++;
    }
    return count;
  }
  if (operation === "count-distinct" || operation === "distinct_count") {
    const seen = new Set<string>();
    for (const row of rows) {
      const val = row[colIndex] ?? null;
      if (val !== null) seen.add(typedKey(val, field.type));
    }
    return seen.size;
  }
  const nums: number[] = [];
  for (const row of rows) {
    const n = toNumberValue(row[colIndex] ?? null, field.type);
    if (n !== null) nums.push(n);
  }
  if (!nums.length) return null;
  switch (operation) {
    case "none":
      return nums[0] ?? null;
    case "sum": {
      let sum = 0;
      for (const n of nums) sum += n;
      return Number.isFinite(sum) ? sum : null;
    }
    case "average": {
      let sum = 0;
      for (const n of nums) sum += n;
      const avg = sum / nums.length;
      return Number.isFinite(avg) ? avg : null;
    }
    case "min": {
      let min = nums[0]!;
      for (let i = 1; i < nums.length; i++) {
        if (nums[i]! < min) min = nums[i]!;
      }
      return min;
    }
    case "max": {
      let max = nums[0]!;
      for (let i = 1; i < nums.length; i++) {
        if (nums[i]! > max) max = nums[i]!;
      }
      return max;
    }
    case "median": {
      nums.sort((a, b) => a - b);
      const mid = (nums.length - 1) / 2;
      const lo = Math.floor(mid);
      const hi = Math.ceil(mid);
      return (nums[lo]! + nums[hi]!) / 2;
    }
    case "variancepop":
    case "stddevpop": {
      let sum = 0;
      for (const n of nums) sum += n;
      const mean = sum / nums.length;
      let sq = 0;
      for (const n of nums) {
        const d = n - mean;
        sq += d * d;
      }
      const variance = sq / nums.length;
      const res = operation === "stddevpop" ? Math.sqrt(variance) : variance;
      return Number.isFinite(res) ? res : null;
    }
    case "variance":
    case "stddev": {
      if (nums.length < 2) return null;
      let sum = 0;
      for (const n of nums) sum += n;
      const mean = sum / nums.length;
      let sq = 0;
      for (const n of nums) {
        const d = n - mean;
        sq += d * d;
      }
      const variance = sq / (nums.length - 1);
      const res = operation === "stddev" ? Math.sqrt(variance) : variance;
      return Number.isFinite(res) ? res : null;
    }
  }
}

function formatFloatTotal(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

function computeTableTotal(
  rows: TypedValue[][],
  colIndex: number,
  field: ResultField,
  operation: PivotConfigV2["values"][number]["aggregation"],
): string | null {
  if (operation === "count" || operation === "count-distinct") {
    const val = computeAggregateNumber(rows, colIndex, field, operation);
    return val === null ? null : String(val);
  }
  if (
    field.type === "integer" &&
    (operation === "sum" || operation === "min" || operation === "max")
  ) {
    let acc: bigint | null = null;
    for (const row of rows) {
      const val = row[colIndex] as bigint | null;
      if (val === null) continue;
      if (acc === null) {
        acc = val;
      } else if (operation === "sum") {
        acc += val;
      } else if (operation === "min") {
        if (val < acc) acc = val;
      } else if (val > acc) {
        acc = val;
      }
    }
    return acc === null ? null : acc.toString();
  }
  if (
    field.type === "decimal" &&
    (operation === "sum" || operation === "min" || operation === "max")
  ) {
    let maxScale = 0;
    let hasValue = false;
    for (const row of rows) {
      const val = row[colIndex] as DecimalValue | null;
      if (val !== null) {
        hasValue = true;
        if (val.scale > maxScale) maxScale = val.scale;
      }
    }
    if (!hasValue) return null;
    let acc: bigint | null = null;
    for (const row of rows) {
      const val = row[colIndex] as DecimalValue | null;
      if (val === null) continue;
      const scaled = val.coeff * 10n ** BigInt(maxScale - val.scale);
      if (acc === null) {
        acc = scaled;
      } else if (operation === "sum") {
        acc += scaled;
      } else if (operation === "min") {
        if (scaled < acc) acc = scaled;
      } else if (scaled > acc) {
        acc = scaled;
      }
    }
    if (acc === null) return null;
    let scale = maxScale;
    while (scale > 0 && acc % 10n === 0n) {
      acc /= 10n;
      scale--;
    }
    if (acc === 0n) scale = 0;
    return formatDecimal(acc, scale);
  }
  const value = computeAggregateNumber(rows, colIndex, field, operation);
  return value === null ? null : formatFloatTotal(value);
}

type CompiledPredicate = (row: TypedValue[]) => boolean;

function compileFilter(
  find: (id: string) => ResolvedField,
  filter: TableFilter,
): CompiledPredicate {
  const { field, index } = find(filter.fieldId);
  switch (filter.op) {
    case "is-null":
      return (row) => (row[index] ?? null) === null;
    case "is-not-null":
      return (row) => (row[index] ?? null) !== null;
    case "in":
    case "not-in": {
      const targets = filter.values.map((v) => parseFilterLiteral(v, field));
      const negate = filter.op === "not-in";
      return (row) => {
        const cell = row[index] ?? null;
        const matched = targets.some(
          (target) => compareNullsFirst(cell, target, field.type) === 0,
        );
        return negate ? !matched : matched;
      };
    }
    case "eq": {
      const target = parseFilterLiteral(filter.value, field);
      return (row) =>
        compareNullsFirst(row[index] ?? null, target, field.type) === 0;
    }
    case "neq": {
      const target = parseFilterLiteral(filter.value, field);
      return (row) =>
        compareNullsFirst(row[index] ?? null, target, field.type) !== 0;
    }
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      const target = parseFilterLiteral(filter.value, field);
      const op = filter.op;
      return (row) => {
        const cell = row[index] ?? null;
        if (cell === null || target === null) return false;
        const cmp = compareNonNull(cell, target, field.type);
        if (op === "lt") return cmp < 0;
        if (op === "lte") return cmp <= 0;
        if (op === "gt") return cmp > 0;
        return cmp >= 0;
      };
    }
    case "contains":
    case "not-contains": {
      if (typeof filter.value !== "string" || field.type !== "string")
        throw new VisualizationBindingError(
          "Text filters require a text field",
        );
      const needle = filter.value.toLowerCase();
      const negate = filter.op === "not-contains";
      return (row) => {
        const cell = row[index] ?? null;
        if (cell === null) return false;
        const matched = (cell as string).toLowerCase().includes(needle);
        return negate ? !matched : matched;
      };
    }
  }
}

function compileRowFilter(
  find: (id: string) => ResolvedField,
  filters: TableFilter[],
  excluded: TableFilter[][] = [],
): CompiledPredicate {
  const compiledFilters = filters.map((filter) => compileFilter(find, filter));
  const compiledExcluded = excluded.map((selection) =>
    selection.map((filter) => compileFilter(find, filter)),
  );
  return (row) => {
    for (const pred of compiledFilters) {
      if (!pred(row)) return false;
    }
    for (const group of compiledExcluded) {
      if (group.length > 0 && group.every((pred) => pred(row))) return false;
    }
    return true;
  };
}

function fieldResolver(fields: ResultField[]) {
  const map = new Map<string, ResolvedField>();
  fields.forEach((field, index) => {
    map.set(field.fieldId, { field, index });
  });
  return function find(id: string): ResolvedField {
    const resolved = map.get(id);
    if (!resolved)
      throw new VisualizationBindingError("Result field was removed");
    return resolved;
  };
}

async function loadTypedRows(
  manifest: CompleteResultManifest,
  fields: ResultField[],
  readInput: () => AsyncIterable<Uint8Array>,
): Promise<TypedValue[][]> {
  const ipc = await joinVisualizationArrow(manifest, readInput());
  const table = tableFromIPC(ipc);
  const vectors = fields.map((field, index) => {
    const vector = table.getChild(String(index)) ?? table.getChildAt(index);
    if (!vector)
      throw new Error("Visualization artifact is missing an Arrow column");
    return { field, vector };
  });
  const rows: TypedValue[][] = new Array(table.numRows);
  for (let r = 0; r < table.numRows; r++) {
    const row: TypedValue[] = new Array(vectors.length);
    for (let c = 0; c < vectors.length; c++) {
      const entry = vectors[c]!;
      row[c] = coerceArrowCell(
        notebookArrowValue(entry.vector, r),
        entry.field,
      );
    }
    rows[r] = row;
  }
  return rows;
}

function boundedPageNumber(totalRows: number, requestedPage: number): number {
  const maxPage = Math.floor((totalRows + PAGE_SIZE - 1) / PAGE_SIZE);
  return Math.max(1, Math.min(requestedPage, maxPage));
}

export async function runLocalMetricTransform(
  manifest: CompleteResultManifest,
  fields: ResultField[],
  readInput: () => AsyncIterable<Uint8Array>,
  fieldId: string,
  aggregation: MetricConfig["aggregation"],
  row: number,
): Promise<PivotScalar> {
  const { field, index } = fieldResolver(fields)(fieldId);
  const rows = await loadTypedRows(manifest, fields, readInput);
  if (!rows.length) return null;
  if (aggregation === null)
    return displayValue(rows.at(row)?.[index] ?? null, field);
  if (aggregation === "min" || aggregation === "max") {
    let bound: TypedValue = null;
    for (const row of rows) {
      const value = row[index] ?? null;
      if (value === null) continue;
      if (
        bound === null ||
        compareNonNull(value, bound, field.type) *
          (aggregation === "min" ? -1 : 1) >
          0
      )
        bound = value;
    }
    return displayValue(bound, field);
  }
  if (
    aggregation === "sum" &&
    (field.type === "integer" || field.type === "decimal")
  )
    return computeTableTotal(rows, index, field, aggregation);
  return computeAggregateNumber(rows, index, field, aggregation);
}

export async function runLocalChartTransform(
  manifest: CompleteResultManifest,
  fields: ResultField[],
  readInput: () => AsyncIterable<Uint8Array>,
  spec: ChartSpec,
): Promise<unknown[]> {
  if (!spec.xField) throw new VisualizationBindingError("Chart has no X field");
  const find = fieldResolver(fields);
  const x = find(spec.xField);
  const configuredUnit =
    spec.xTimeUnit ??
    (x.field.type === "date" || x.field.type === "datetime" ? "month" : "none");
  const unit =
    x.field.type === "date" &&
    ["hour", "minute", "second"].includes(configuredUnit)
      ? "day"
      : configuredUnit;
  const bucket =
    unit !== "none" && (x.field.type === "date" || x.field.type === "datetime");
  const series = spec.seriesField ? find(spec.seriesField) : null;
  const yFieldIds = chartMeasureFieldIds(spec);
  if (series && yFieldIds.length > 1)
    throw new VisualizationBindingError(
      "Choose one measure when coloring by a field",
    );
  const operation = spec.yAggregation ?? "sum";
  const resolvedMeasures = yFieldIds.map((id) => {
    const y = id ? find(id) : null;
    if (!y && !spec.countRecords)
      throw new VisualizationBindingError("Chart has no Y field");
    if (y) validateAggregate(y.field, operation);
    return y;
  });
  const keepRow = compileRowFilter(
    find,
    spec.filters ?? [],
    spec.excludedMarks ?? [],
  );

  const allRows = await loadTypedRows(manifest, fields, readInput);
  const filteredRows = allRows.filter(keepRow);

  function extractX(row: TypedValue[]): TypedValue {
    const raw = row[x.index] ?? null;
    if (raw === null || !bucket) return raw;
    if (x.field.type === "date")
      return truncateDateMs(raw as number, unit as TimeBucket);
    return truncateTimestampMicros(raw as bigint, unit as TimeBucket);
  }

  type MarkEntry = {
    xVal: TypedValue;
    xDisplay: PivotScalar;
    seriesVal: TypedValue;
    seriesDisplay: PivotScalar;
    value: number | null;
  };
  const seriesCompareType: ResultField["type"] = series
    ? series.field.type
    : "string";
  const marks: MarkEntry[] = [];

  for (const y of resolvedMeasures) {
    const constantSeries =
      !series && yFieldIds.length > 1 && y ? y.field.name : null;
    if (operation === "none" && y) {
      for (const row of filteredRows) {
        const xVal = extractX(row);
        const seriesVal = series ? (row[series.index] ?? null) : constantSeries;
        marks.push({
          xVal,
          xDisplay: displayValue(xVal, x.field),
          seriesVal,
          seriesDisplay: series
            ? displayValue(seriesVal, series.field)
            : constantSeries,
          value: toNumberValue(row[y.index] ?? null, y.field.type),
        });
      }
      continue;
    }
    const groups = new Map<
      string,
      { xVal: TypedValue; seriesVal: TypedValue; rows: TypedValue[][] }
    >();
    for (const row of filteredRows) {
      const xVal = extractX(row);
      const seriesVal = series ? (row[series.index] ?? null) : constantSeries;
      const key = series
        ? `${typedKey(xVal, x.field.type)}\0${typedKey(seriesVal, series.field.type)}`
        : typedKey(xVal, x.field.type);
      let bucketGroup = groups.get(key);
      if (!bucketGroup) {
        bucketGroup = { xVal, seriesVal, rows: [] };
        groups.set(key, bucketGroup);
      }
      bucketGroup.rows.push(row);
    }
    for (const group of groups.values()) {
      const value = y
        ? computeAggregateNumber(group.rows, y.index, y.field, operation)
        : group.rows.length;
      marks.push({
        xVal: group.xVal,
        xDisplay: displayValue(group.xVal, x.field),
        seriesVal: group.seriesVal,
        seriesDisplay: series
          ? displayValue(group.seriesVal, series.field)
          : constantSeries,
        value,
      });
    }
  }

  marks.sort((a, b) => {
    const cx = compareNullsFirst(a.xVal, b.xVal, x.field.type);
    if (cx !== 0) return cx;
    const cs = compareNullsFirst(a.seriesVal, b.seriesVal, seriesCompareType);
    if (cs !== 0) return cs;
    return compareNullsFirst(a.value, b.value, "number");
  });

  const payload: unknown[] = marks
    .slice(0, GROUP_PROBE)
    .map((m) => [0, m.xDisplay, m.seriesDisplay, m.value]);

  if (series) {
    const distinctSeries = new Map<string, TypedValue>();
    for (const row of allRows) {
      const val = row[series.index] ?? null;
      const key = typedKey(val, series.field.type);
      if (!distinctSeries.has(key)) distinctSeries.set(key, val);
    }
    const sortedPalette = [...distinctSeries.values()]
      .sort((a, b) => compareNullsFirst(a, b, series.field.type))
      .slice(0, GROUP_PROBE);
    for (const val of sortedPalette) {
      payload.push([1, displayValue(val, series.field), null, null]);
    }
  }

  return payload;
}

export async function runLocalTablePageTransform(
  manifest: CompleteResultManifest,
  fields: ResultField[],
  readInput: () => AsyncIterable<Uint8Array>,
  options: {
    filters: TableFilter[];
    excluded?: TableFilter[][] | undefined;
    sort: Sort | null;
    totals: TableConfig["totals"];
    page: number;
  },
): Promise<unknown[]> {
  const find = fieldResolver(fields);
  const ordered = options.sort ? find(options.sort.fieldId) : null;
  for (const [id, op] of Object.entries(options.totals)) {
    const target = find(id);
    validateAggregate(target.field, op);
  }
  const keepRow = compileRowFilter(
    find,
    options.filters,
    options.excluded ?? [],
  );

  const allRows = await loadTypedRows(manifest, fields, readInput);
  const filtered: { row: TypedValue[]; ordinal: number }[] = [];
  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i]!;
    if (keepRow(row)) filtered.push({ row, ordinal: filtered.length });
  }
  const filteredRows = filtered.map((entry) => entry.row);
  const totalRows = filtered.length;
  const totals = fields.map((field, index) => {
    const op = options.totals[field.fieldId];
    return op ? computeTableTotal(filteredRows, index, field, op) : null;
  });

  if (ordered && options.sort) {
    const dir = options.sort.direction;
    filtered.sort((a, b) => {
      const cmp = compareNullsLast(
        a.row[ordered.index] ?? null,
        b.row[ordered.index] ?? null,
        ordered.field.type,
        dir,
      );
      return cmp !== 0 ? cmp : a.ordinal - b.ordinal;
    });
  }

  const page = boundedPageNumber(totalRows, options.page);
  const start = (page - 1) * PAGE_SIZE;
  const pageRows = filtered
    .slice(start, start + PAGE_SIZE)
    .map(({ row }) =>
      fields.map((field, index) => displayValue(row[index] ?? null, field)),
    );

  return [[totalRows, page, totals, pageRows]];
}

export async function runLocalPivotTransform(
  manifest: CompleteResultManifest,
  fields: ResultField[],
  readInput: () => AsyncIterable<Uint8Array>,
  config: PivotConfigV2,
  options?: {
    drillFilters?: TableFilter[] | undefined;
    drillField?: string | undefined;
    page?: number | undefined;
  },
): Promise<unknown[]> {
  const find = fieldResolver(fields);
  const rowDims = config.rows.map(find);
  const colDims = config.columns.map(find);
  const dimensions = [...rowDims, ...colDims];
  const measures = config.values.map(({ fieldId, aggregation }) => {
    const target = find(fieldId);
    validateAggregate(target.field, aggregation);
    return { target, aggregation };
  });
  const drillTarget = options?.drillField ? find(options.drillField) : null;
  const keepRow = compileRowFilter(find, [
    ...config.filters,
    ...(options?.drillFilters ?? []),
  ]);

  const allRows = await loadTypedRows(manifest, fields, readInput);
  const filteredRows = allRows.filter(keepRow);

  if (drillTarget) {
    const groups = new Map<
      string,
      { dimVal: TypedValue; rows: TypedValue[][] }
    >();
    for (const row of filteredRows) {
      const dimVal = row[drillTarget.index] ?? null;
      const key = typedKey(dimVal, drillTarget.field.type);
      let group = groups.get(key);
      if (!group) {
        group = { dimVal, rows: [] };
        groups.set(key, group);
      }
      group.rows.push(row);
    }
    const sorted = [...groups.values()].sort((a, b) =>
      compareNullsFirst(a.dimVal, b.dimVal, drillTarget.field.type),
    );
    const totalRows = sorted.length;
    const page = boundedPageNumber(totalRows, options?.page ?? 1);
    const start = (page - 1) * PAGE_SIZE;
    const pageRows = sorted
      .slice(start, start + PAGE_SIZE)
      .map((group) => [
        displayValue(group.dimVal, drillTarget.field),
        ...measures.map(({ target, aggregation }) =>
          computeAggregateNumber(
            group.rows,
            target.index,
            target.field,
            aggregation,
          ),
        ),
      ]);
    return [[totalRows, page, [], pageRows]];
  }

  if (!filteredRows.length) return [];

  if (!dimensions.length) {
    const values = measures.map(({ target, aggregation }) =>
      computeAggregateNumber(
        filteredRows,
        target.index,
        target.field,
        aggregation,
      ),
    );
    return [[[], [], values]];
  }

  function axisGroups(length: number, totals: boolean, start: number) {
    const sizes = [length];
    if (config.subtotals)
      for (let size = length - 1; size > 0; size--) sizes.push(size);
    if (totals && length) sizes.push(0);
    return sizes.map((size) => {
      const indices: number[] = [];
      for (let i = start; i < start + size; i++) indices.push(i);
      return indices;
    });
  }

  const groupingSets = axisGroups(
    rowDims.length,
    config.columnTotals,
    0,
  ).flatMap((r) =>
    axisGroups(colDims.length, config.rowTotals, rowDims.length).map((c) => [
      ...r,
      ...c,
    ]),
  );

  type PivotGroupEntry = {
    omitted: (0 | 1)[];
    omittedSum: number;
    rawKeys: TypedValue[];
    displayKeys: PivotScalar[];
    values: (number | null)[];
  };
  const results: PivotGroupEntry[] = [];

  for (const activeIndices of groupingSets) {
    const activeSet = new Set(activeIndices);
    const omitted: (0 | 1)[] = dimensions.map((_, idx) =>
      activeSet.has(idx) ? 0 : 1,
    );
    let omittedSum = 0;
    for (const bit of omitted) omittedSum += bit;

    const groups = new Map<
      string,
      { rawKeys: TypedValue[]; rows: TypedValue[][] }
    >();
    for (const row of filteredRows) {
      const keyParts: string[] = [];
      for (const dimIdx of activeIndices) {
        const dim = dimensions[dimIdx]!;
        keyParts.push(typedKey(row[dim.index] ?? null, dim.field.type));
      }
      const key = JSON.stringify(keyParts);
      let group = groups.get(key);
      if (!group) {
        const rawKeys = dimensions.map((dim, idx) =>
          activeSet.has(idx) ? (row[dim.index] ?? null) : null,
        );
        group = { rawKeys, rows: [] };
        groups.set(key, group);
      }
      group.rows.push(row);
    }

    for (const group of groups.values()) {
      results.push({
        omitted,
        omittedSum,
        rawKeys: group.rawKeys,
        displayKeys: dimensions.map((dim, idx) =>
          omitted[idx]
            ? null
            : displayValue(group.rawKeys[idx] ?? null, dim.field),
        ),
        values: measures.map(({ target, aggregation }) =>
          computeAggregateNumber(
            group.rows,
            target.index,
            target.field,
            aggregation,
          ),
        ),
      });
    }
  }

  results.sort((a, b) => {
    if (a.omittedSum !== b.omittedSum) return b.omittedSum - a.omittedSum;
    for (let i = 0; i < dimensions.length; i++) {
      const ob = a.omitted[i]! - b.omitted[i]!;
      if (ob !== 0) return ob;
      const cmp = compareNullsFirst(
        a.rawKeys[i] ?? null,
        b.rawKeys[i] ?? null,
        dimensions[i]!.field.type,
      );
      if (cmp !== 0) return cmp;
    }
    return 0;
  });

  return results
    .slice(0, GROUP_PROBE)
    .map((entry) => [entry.omitted, entry.displayKeys, entry.values]);
}

export async function runLocalChartDrillTransform(
  manifest: CompleteResultManifest,
  fields: ResultField[],
  readInput: () => AsyncIterable<Uint8Array>,
  spec: ChartSpec,
  selection: TableFilter[],
  nextFieldId: string,
  requestedPage: number,
): Promise<unknown[]> {
  const find = fieldResolver(fields);
  const dim = find(nextFieldId);
  const ids = chartMeasureFieldIds(spec);
  const operation = spec.yAggregation ?? "sum";
  const aggregateRows = operation !== "none" || Boolean(spec.countRecords);
  const resolvedMeasures = ids.map((id) => {
    const measure = id ? find(id) : null;
    if (measure) validateAggregate(measure.field, operation);
    return measure;
  });
  const keepRow = compileRowFilter(
    find,
    [...(spec.filters ?? []), ...selection],
    spec.excludedMarks ?? [],
  );

  const allRows = await loadTypedRows(manifest, fields, readInput);
  const filteredRows = allRows.filter(keepRow);

  type DrillRow = { dimVal: TypedValue; values: (number | null)[] };
  const outputRows: DrillRow[] = [];

  if (aggregateRows) {
    const groups = new Map<
      string,
      { dimVal: TypedValue; rows: TypedValue[][] }
    >();
    for (const row of filteredRows) {
      const dimVal = row[dim.index] ?? null;
      const key = typedKey(dimVal, dim.field.type);
      let group = groups.get(key);
      if (!group) {
        group = { dimVal, rows: [] };
        groups.set(key, group);
      }
      group.rows.push(row);
    }
    for (const group of groups.values()) {
      outputRows.push({
        dimVal: group.dimVal,
        values: resolvedMeasures.map((measure) =>
          measure
            ? computeAggregateNumber(
                group.rows,
                measure.index,
                measure.field,
                operation,
              )
            : group.rows.length,
        ),
      });
    }
  } else {
    for (const row of filteredRows) {
      outputRows.push({
        dimVal: row[dim.index] ?? null,
        values: resolvedMeasures.map((measure) =>
          measure
            ? toNumberValue(row[measure.index] ?? null, measure.field.type)
            : 1,
        ),
      });
    }
  }

  outputRows.sort((a, b) =>
    compareNullsFirst(a.dimVal, b.dimVal, dim.field.type),
  );

  const totalRows = outputRows.length;
  const page = boundedPageNumber(totalRows, requestedPage);
  const start = (page - 1) * PAGE_SIZE;
  const pageRows = outputRows
    .slice(start, start + PAGE_SIZE)
    .map((entry) => [displayValue(entry.dimVal, dim.field), ...entry.values]);

  return [[totalRows, page, [], pageRows]];
}
