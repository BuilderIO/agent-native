export type AggregateOp =
  | "sum"
  | "avg"
  | "count"
  | "min"
  | "max"
  | "count_distinct";

export interface AggregateField {
  column: string;
  op: AggregateOp;
  as?: string;
}

export type FilterOp =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "exists"
  | "not_exists";

export interface WhereClause {
  column: string;
  op: FilterOp;
  value?: unknown;
}

export interface AggregateQuery {
  where?: WhereClause[];
  groupBy?: string[];
  aggregate?: AggregateField[];
  select?: string[];
  orderBy?: string;
  orderDir?: "asc" | "desc";
  limit?: number;
}

function getField(row: Record<string, unknown>, column: string): unknown {
  return row[column];
}

function coerceNum(v: unknown): number {
  if (v === null || v === undefined) return NaN;
  return Number(v);
}

function matchesFilter(
  row: Record<string, unknown>,
  clause: WhereClause,
): boolean {
  const val = getField(row, clause.column);
  switch (clause.op) {
    case "equals":
      // eslint-disable-next-line eqeqeq
      return val == clause.value;
    case "not_equals":
      // eslint-disable-next-line eqeqeq
      return val != clause.value;
    case "contains":
      return typeof val === "string" && typeof clause.value === "string"
        ? val.toLowerCase().includes(clause.value.toLowerCase())
        : false;
    case "not_contains":
      return typeof val === "string" && typeof clause.value === "string"
        ? !val.toLowerCase().includes(clause.value.toLowerCase())
        : true;
    case "gt":
      return coerceNum(val) > coerceNum(clause.value);
    case "gte":
      return coerceNum(val) >= coerceNum(clause.value);
    case "lt":
      return coerceNum(val) < coerceNum(clause.value);
    case "lte":
      return coerceNum(val) <= coerceNum(clause.value);
    case "exists":
      return val !== null && val !== undefined && val !== "";
    case "not_exists":
      return val === null || val === undefined || val === "";
    default:
      return true;
  }
}

function applyWhere(
  rows: Record<string, unknown>[],
  where: WhereClause[],
): Record<string, unknown>[] {
  if (!where.length) return rows;
  return rows.filter((row) =>
    where.every((clause) => matchesFilter(row, clause)),
  );
}

interface GroupAccumulator {
  count: number;
  sums: Record<string, number>;
  mins: Record<string, number>;
  maxs: Record<string, number>;
  distinctSets: Record<string, Set<unknown>>;
  nums: Record<string, number[]>;
}

function newAccumulator(): GroupAccumulator {
  return { count: 0, sums: {}, mins: {}, maxs: {}, distinctSets: {}, nums: {} };
}

function accumulate(
  acc: GroupAccumulator,
  row: Record<string, unknown>,
  fields: AggregateField[],
): void {
  acc.count++;
  for (const f of fields) {
    const val = getField(row, f.column);
    const num = coerceNum(val);
    if (f.op === "sum" || f.op === "avg") {
      acc.sums[f.column] = (acc.sums[f.column] ?? 0) + (isNaN(num) ? 0 : num);
      if (!acc.nums[f.column]) acc.nums[f.column] = [];
      if (!isNaN(num)) acc.nums[f.column].push(num);
    } else if (f.op === "min") {
      if (!isNaN(num)) {
        acc.mins[f.column] =
          acc.mins[f.column] === undefined
            ? num
            : Math.min(acc.mins[f.column], num);
      }
    } else if (f.op === "max") {
      if (!isNaN(num)) {
        acc.maxs[f.column] =
          acc.maxs[f.column] === undefined
            ? num
            : Math.max(acc.maxs[f.column], num);
      }
    } else if (f.op === "count_distinct") {
      if (!acc.distinctSets[f.column]) acc.distinctSets[f.column] = new Set();
      acc.distinctSets[f.column].add(val);
    }
  }
}

function finalizeAccumulator(
  acc: GroupAccumulator,
  fields: AggregateField[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const outKey = f.as ?? `${f.op}_${f.column}`;
    if (f.op === "count") {
      out[outKey] = acc.count;
    } else if (f.op === "sum") {
      out[outKey] = acc.sums[f.column] ?? 0;
    } else if (f.op === "avg") {
      const nums = acc.nums[f.column] ?? [];
      out[outKey] = nums.length
        ? nums.reduce((a, b) => a + b, 0) / nums.length
        : null;
    } else if (f.op === "min") {
      out[outKey] = acc.mins[f.column] ?? null;
    } else if (f.op === "max") {
      out[outKey] = acc.maxs[f.column] ?? null;
    } else if (f.op === "count_distinct") {
      out[outKey] = acc.distinctSets[f.column]?.size ?? 0;
    }
  }
  return out;
}

function applyAggregate(
  rows: Record<string, unknown>[],
  groupBy: string[],
  fields: AggregateField[],
): Record<string, unknown>[] {
  const groups = new Map<
    string,
    { keys: Record<string, unknown>; acc: GroupAccumulator }
  >();
  for (const row of rows) {
    const keyObj: Record<string, unknown> = {};
    for (const col of groupBy) keyObj[col] = row[col] ?? null;
    const keyStr = JSON.stringify(keyObj);
    if (!groups.has(keyStr)) {
      groups.set(keyStr, { keys: keyObj, acc: newAccumulator() });
    }
    accumulate(groups.get(keyStr)!.acc, row, fields);
  }

  if (groups.size === 0 && rows.length > 0) {
    const acc = newAccumulator();
    for (const row of rows) accumulate(acc, row, fields);
    return [finalizeAccumulator(acc, fields)];
  }

  if (groups.size === 0) return [];

  return Array.from(groups.values()).map(({ keys, acc }) => ({
    ...keys,
    ...finalizeAccumulator(acc, fields),
  }));
}

function applySort(
  rows: Record<string, unknown>[],
  orderBy: string,
  dir: "asc" | "desc",
): Record<string, unknown>[] {
  return [...rows].sort((a, b) => {
    const av = a[orderBy];
    const bv = b[orderBy];
    const an = coerceNum(av);
    const bn = coerceNum(bv);
    if (!isNaN(an) && !isNaN(bn)) {
      return dir === "asc" ? an - bn : bn - an;
    }
    const as = String(av ?? "");
    const bs = String(bv ?? "");
    if (as < bs) return dir === "asc" ? -1 : 1;
    if (as > bs) return dir === "asc" ? 1 : -1;
    return 0;
  });
}

export function runAggregateQuery(
  rows: Record<string, unknown>[],
  query: AggregateQuery,
): Record<string, unknown>[] {
  let result = applyWhere(rows, query.where ?? []);

  if (query.aggregate && query.aggregate.length > 0) {
    result = applyAggregate(result, query.groupBy ?? [], query.aggregate);
  } else if (query.select && query.select.length > 0) {
    const cols = query.select;
    result = result.map((row) => {
      const out: Record<string, unknown> = {};
      for (const col of cols) out[col] = row[col] ?? null;
      return out;
    });
  }

  if (query.orderBy) {
    result = applySort(result, query.orderBy, query.orderDir ?? "asc");
  }

  if (query.limit && query.limit > 0) {
    result = result.slice(0, query.limit);
  }

  return result;
}
