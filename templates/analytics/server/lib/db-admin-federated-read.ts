import { createDataTableWidgetResult } from "@agent-native/core/data-widgets";
import { runSql, type DbAdminRuntime } from "@agent-native/core/db-admin";
import { z } from "zod";

import {
  type DbAdminAdminContext,
  withDbAdminConnectionRuntime,
} from "./db-admin-connections";

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NUMERIC_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const TEMPORAL_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const MUTATING_WORD_RE =
  /(^|[^A-Za-z_])(insert|update|delete|replace|create|alter|drop|truncate|merge)(?=[^A-Za-z_]|$)/i;
const MAX_SOURCE_ROWS = 500;

function sanitizeSqlForInspection(sql: string): string {
  let out = "";
  let state: "code" | "single" | "double" | "line" | "block" = "code";
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (state === "line") {
      out += ch === "\n" || ch === "\r" ? ch : " ";
      if (ch === "\n" || ch === "\r") state = "code";
      continue;
    }
    if (state === "block") {
      if (ch === "*" && next === "/") {
        out += "  ";
        i += 1;
        state = "code";
      } else {
        out += " ";
      }
      continue;
    }
    if (state === "single") {
      if (ch === "'" && next === "'") {
        out += "  ";
        i += 1;
      } else if (ch === "'") {
        out += " ";
        state = "code";
      } else {
        out += " ";
      }
      continue;
    }
    if (state === "double") {
      if (ch === '"' && next === '"') {
        out += "  ";
        i += 1;
      } else if (ch === '"') {
        out += " ";
        state = "code";
      } else {
        out += " ";
      }
      continue;
    }
    if (ch === "-" && next === "-") {
      out += "  ";
      i += 1;
      state = "line";
      continue;
    }
    if (ch === "/" && next === "*") {
      out += "  ";
      i += 1;
      state = "block";
      continue;
    }
    if (ch === "'") {
      out += " ";
      state = "single";
      continue;
    }
    if (ch === '"') {
      out += " ";
      state = "double";
      continue;
    }
    out += ch;
  }
  return out;
}

function assertReadOnlySql(sql: string): void {
  const cleaned = sanitizeSqlForInspection(sql).trim();
  if (!/^(select|with)\b/i.test(cleaned)) {
    throw new Error("Source SQL must start with SELECT or WITH.");
  }
  const statement = cleaned.replace(/;\s*$/, "");
  if (statement.includes(";")) {
    throw new Error("Source SQL must be a single statement.");
  }
  if (/\binto\b/i.test(statement)) {
    throw new Error("Source SQL must not use SELECT INTO.");
  }
  if (
    /\bfor\s+(?:no\s+key\s+)?(?:update|share|key\s+share)\b/i.test(statement)
  ) {
    throw new Error("Source SQL must not lock rows.");
  }
  if (MUTATING_WORD_RE.test(statement)) {
    throw new Error("Source SQL must be read-only.");
  }
}

function normalizeSourceId(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const id = raw || fallback;
  if (!IDENT_RE.test(id)) throw new Error("Source ids must be simple names.");
  return id;
}

function normalizeColumnName(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function canonicalNumeric(value: string): string | null {
  const text = value.trim();
  if (!NUMERIC_RE.test(text)) return null;
  const sign = text.startsWith("-") ? "-" : "";
  const unsigned = text.replace(/^[+-]/, "");
  const [integerPart, fractionPart = ""] = unsigned.split(".");
  const integer = integerPart.replace(/^0+(?=\d)/, "") || "0";
  const fraction = fractionPart.replace(/0+$/, "");
  if (integer === "0" && !fraction) return "0";
  return `${sign}${integer}${fraction ? `.${fraction}` : ""}`;
}

function canonicalTemporal(value: string | Date): string | null {
  if (value instanceof Date && Number.isNaN(value.getTime())) return null;
  const text = value instanceof Date ? value.toISOString() : value.trim();
  if (!TEMPORAL_RE.test(text)) return null;
  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const withZone =
    normalized.length === 10 || /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
      ? normalized
      : `${normalized}Z`;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function rowKey(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const temporal = canonicalTemporal(value);
    return temporal ? `t:${temporal}` : `j:${JSON.stringify(value)}`;
  }
  if (typeof value === "string") {
    const temporal = canonicalTemporal(value);
    if (temporal) return `t:${temporal}`;
    const numeric = canonicalNumeric(value);
    return numeric ? `n:${numeric}` : `s:${value}`;
  }
  if (typeof value === "number") {
    const numeric = Number.isFinite(value)
      ? canonicalNumeric(String(value))
      : null;
    return numeric
      ? `n:${numeric}`
      : `n:${Number.isNaN(value) ? "NaN" : value}`;
  }
  if (typeof value === "boolean") return `b:${value ? "1" : "0"}`;
  if (typeof value === "bigint") return `n:${value.toString()}`;
  return `j:${JSON.stringify(value)}`;
}

function inferAlign(value: unknown): "left" | "right" {
  return typeof value === "number" || typeof value === "bigint"
    ? "right"
    : "left";
}

function pickRowColumns(
  row: Record<string, unknown> | undefined,
  fallbackColumns: string[],
): string[] {
  return row ? Object.keys(row) : fallbackColumns;
}

export const federatedDbAdminSourceSchema = z.object({
  connectionId: z.string().trim().min(1).max(200),
  sourceId: z.string().trim().min(1).max(64).optional(),
  sql: z.string().trim().min(1).max(20_000),
  params: z.array(z.unknown()).max(50).optional(),
});

export const federatedDbAdminJoinSchema = z.object({
  kind: z.enum(["inner", "left"]),
  leftSourceId: z.string().trim().min(1).optional(),
  leftColumn: z.string().trim().min(1),
  rightSourceId: z.string().trim().min(1).optional(),
  rightColumn: z.string().trim().min(1),
});

export const federatedDbAdminProjectionSchema = z.object({
  sourceId: z.string().trim().min(1).optional(),
  column: z.string().trim().min(1),
  as: z.string().trim().min(1).optional(),
});

export const federatedDbAdminReadSchema = z
  .object({
    sources: z.array(federatedDbAdminSourceSchema).min(1).max(2),
    join: federatedDbAdminJoinSchema.optional(),
    projections: z.array(federatedDbAdminProjectionSchema).max(50).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.sources.length === 1 && value.join) {
      ctx.addIssue({
        code: "custom",
        path: ["join"],
        message: "A join requires two sources.",
      });
    }
    if (value.sources.length === 2 && !value.join) {
      ctx.addIssue({
        code: "custom",
        path: ["join"],
        message: "A join is required when two sources are supplied.",
      });
    }
  });

type FederatedDbAdminReadArgs = z.infer<typeof federatedDbAdminReadSchema>;

type SourceResult = {
  sourceId: string;
  connectionId: string;
  rows: Record<string, unknown>[];
  columns: string[];
  truncated: boolean;
  truncatedCells: number;
};

type NormalizedProjection = {
  sourceId?: string;
  column: string;
  as: string;
};

function flattenRow(
  source: SourceResult,
  row: Record<string, unknown>,
  prefix = false,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const columns = source.columns.length ? source.columns : Object.keys(row);
  for (const key of columns) {
    out[prefix ? `${source.sourceId}.${key}` : key] = row[key] ?? null;
  }
  return out;
}

function getProjectedValue(
  rows: Map<string, Record<string, unknown>>,
  projection: NormalizedProjection,
  sourceOrder: string[],
): unknown {
  if (projection.sourceId) {
    const row = rows.get(projection.sourceId);
    if (!row) {
      throw new Error(
        `Projection source "${projection.sourceId}" was not found.`,
      );
    }
    return row[projection.column] ?? null;
  }

  let matchedValue: unknown;
  let matched = false;
  for (const sourceId of sourceOrder) {
    const value = rows.get(sourceId)?.[projection.column];
    if (value === undefined) continue;
    if (matched)
      throw new Error(`Projection column "${projection.column}" is ambiguous.`);
    matched = true;
    matchedValue = value;
  }
  if (!matched) {
    throw new Error(`Projection column "${projection.column}" was not found.`);
  }
  return matchedValue;
}

function buildRows(
  sources: SourceResult[],
  join: z.infer<typeof federatedDbAdminJoinSchema> | undefined,
  projections: NormalizedProjection[] | undefined,
  limit: number,
): { rows: Record<string, unknown>[]; truncated: boolean } {
  if (sources.length === 1) {
    if (join) throw new Error("A join requires two sources.");
    const [source] = sources;
    const projectedColumns =
      projections?.map((projection) => projection.as) ??
      pickRowColumns(source.rows[0], source.columns);
    const rows = source.rows
      .slice(0, limit)
      .map((row) =>
        projections?.length
          ? Object.fromEntries(
              projections.map((projection) => [
                projection.as,
                getProjectedValue(
                  new Map([[source.sourceId, row]]),
                  projection,
                  [source.sourceId],
                ),
              ]),
            )
          : flattenRow(source, row, true),
      );
    if (rows.length === 0 && projectedColumns.length === 0) {
      throw new Error(
        "The query returned no rows, so column names could not be inferred.",
      );
    }
    return {
      rows,
      truncated: source.truncated || source.rows.length > rows.length,
    };
  }

  if (!join) {
    throw new Error("A join is required when two sources are supplied.");
  }

  if (sources.some((source) => source.truncatedCells > 0)) {
    throw new Error(
      "Cannot join a source with truncated large-cell values; project a shorter join key.",
    );
  }

  const leftSourceId = normalizeSourceId(
    join.leftSourceId,
    sources[0].sourceId,
  );
  const rightSourceId = normalizeSourceId(
    join.rightSourceId,
    sources[1].sourceId,
  );
  if (leftSourceId === rightSourceId) {
    throw new Error("Join source ids must be different.");
  }

  const left = sources.find((source) => source.sourceId === leftSourceId);
  const right = sources.find((source) => source.sourceId === rightSourceId);
  if (!left || !right)
    throw new Error("Join source ids must match the supplied sources.");

  if (left.columns.length > 0 && !left.columns.includes(join.leftColumn)) {
    throw new Error(`Left join column "${join.leftColumn}" was not found.`);
  }
  if (right.columns.length > 0 && !right.columns.includes(join.rightColumn)) {
    throw new Error(`Right join column "${join.rightColumn}" was not found.`);
  }

  const rightByKey = new Map<string, Record<string, unknown>[]>();
  for (const row of right.rows) {
    const key = rowKey(row[join.rightColumn]);
    if (!key) continue;
    const bucket = rightByKey.get(key);
    if (bucket) bucket.push(row);
    else rightByKey.set(key, [row]);
  }

  const output: Record<string, unknown>[] = [];
  for (const leftRow of left.rows) {
    const key = rowKey(leftRow[join.leftColumn]);
    const matches = key ? (rightByKey.get(key) ?? []) : [];
    if (matches.length === 0) {
      if (join.kind !== "left") continue;
      const rowMap = new Map<string, Record<string, unknown>>([
        [left.sourceId, leftRow],
        [right.sourceId, {}],
      ]);
      output.push(
        projections?.length
          ? Object.fromEntries(
              projections.map((projection) => [
                projection.as,
                getProjectedValue(rowMap, projection, [
                  left.sourceId,
                  right.sourceId,
                ]),
              ]),
            )
          : {
              ...flattenRow(left, leftRow, true),
              ...flattenRow(right, {}, true),
            },
      );
      if (output.length > limit) break;
      continue;
    }

    for (const rightRow of matches) {
      const rowMap = new Map<string, Record<string, unknown>>([
        [left.sourceId, leftRow],
        [right.sourceId, rightRow],
      ]);
      output.push(
        projections?.length
          ? Object.fromEntries(
              projections.map((projection) => [
                projection.as,
                getProjectedValue(rowMap, projection, [
                  left.sourceId,
                  right.sourceId,
                ]),
              ]),
            )
          : {
              ...flattenRow(left, leftRow, true),
              ...flattenRow(right, rightRow, true),
            },
      );
      if (output.length > limit) break;
    }
    if (output.length > limit) break;
  }

  return {
    rows: output.slice(0, limit),
    truncated:
      sources.some((source) => source.truncated) || output.length > limit,
  };
}

function normalizeSourceIds(
  sources: FederatedDbAdminReadArgs["sources"],
): string[] {
  const ids = sources.map((source, index) =>
    normalizeSourceId(source.sourceId, `source${index + 1}`),
  );
  if (new Set(ids).size !== ids.length) {
    throw new Error("Source ids must be unique.");
  }
  return ids;
}

function normalizeProjections(
  projections: FederatedDbAdminReadArgs["projections"],
  sources: SourceResult[],
): NormalizedProjection[] | undefined {
  if (!projections?.length) return undefined;
  const sourceIds = new Set(sources.map((source) => source.sourceId));
  const normalized = projections.map((projection) => ({
    sourceId: projection.sourceId?.trim() || undefined,
    column: normalizeColumnName(projection.column, "Projection column"),
    as: normalizeColumnName(
      projection.as ?? projection.column,
      "Projection alias",
    ),
  }));
  if (
    new Set(normalized.map((projection) => projection.as)).size !==
    normalized.length
  ) {
    throw new Error("Projection aliases must be unique.");
  }
  for (const projection of normalized) {
    if (projection.sourceId) {
      if (!sourceIds.has(projection.sourceId)) {
        throw new Error(
          `Projection source "${projection.sourceId}" was not found.`,
        );
      }
      const source = sources.find(
        (candidate) => candidate.sourceId === projection.sourceId,
      );
      if (
        source?.columns.length &&
        !source.columns.includes(projection.column)
      ) {
        throw new Error(
          `Projection column "${projection.column}" was not found in source "${projection.sourceId}".`,
        );
      }
      continue;
    }
    const matchingSources = sources.filter((source) =>
      source.columns.includes(projection.column),
    );
    if (matchingSources.length > 1) {
      throw new Error(`Projection column "${projection.column}" is ambiguous.`);
    }
    if (
      sources.every((source) => source.columns.length > 0) &&
      matchingSources.length === 0
    ) {
      throw new Error(
        `Projection column "${projection.column}" was not found.`,
      );
    }
  }
  return normalized;
}

function boundedSourceSql(sql: string): string {
  const statement = sql.trim().replace(/;\s*$/, "");
  return `SELECT * FROM (${statement}\n) AS "__agent_native_source" LIMIT ${MAX_SOURCE_ROWS + 1}`;
}

export async function runDbAdminFederatedRead(
  ctx: DbAdminAdminContext,
  args: FederatedDbAdminReadArgs,
): Promise<ReturnType<typeof createDataTableWidgetResult>> {
  const limit = args.limit ?? 50;
  const sourceIds = normalizeSourceIds(args.sources);
  for (const source of args.sources) assertReadOnlySql(source.sql);
  const sources = await Promise.all(
    args.sources.map((source, index) =>
      withDbAdminConnectionRuntime(
        ctx,
        source.connectionId,
        async (runtime, connection) => {
          const sql = boundedSourceSql(source.sql);
          const read = (dbRuntime: DbAdminRuntime) =>
            runSql(sql, source.params, {}, dbRuntime);
          const result = runtime.db?.transaction
            ? await runtime.db.transaction(async (tx) => {
                await tx.execute("SET TRANSACTION READ ONLY");
                return read({ ...runtime, db: tx });
              })
            : await read(runtime);
          return {
            sourceId: sourceIds[index],
            connectionId: connection.id,
            rows: result.rows.slice(0, MAX_SOURCE_ROWS),
            columns: pickRowColumns(result.rows[0], result.columns),
            truncated: result.rows.length > MAX_SOURCE_ROWS,
            truncatedCells: result.truncatedCells ?? 0,
          } satisfies SourceResult;
        },
      ),
    ),
  );

  const projections = normalizeProjections(args.projections, sources);
  const join = args.join
    ? {
        kind: args.join.kind,
        leftSourceId: args.join.leftSourceId?.trim() || undefined,
        leftColumn: normalizeColumnName(
          args.join.leftColumn,
          "Left join column",
        ),
        rightSourceId: args.join.rightSourceId?.trim() || undefined,
        rightColumn: normalizeColumnName(
          args.join.rightColumn,
          "Right join column",
        ),
      }
    : undefined;

  const output = buildRows(sources, join, projections, limit);
  const columns = projections?.length
    ? projections.map((projection) => ({
        key: projection.as,
        label: projection.as,
        ...(inferAlign(output.rows[0]?.[projection.as]) === "right"
          ? { align: "right" as const }
          : {}),
      }))
    : sources
        .flatMap((source) =>
          source.columns.map((column) => `${source.sourceId}.${column}`),
        )
        .map((key) => ({
          key,
          label: key,
          ...(inferAlign(output.rows[0]?.[key]) === "right"
            ? { align: "right" as const }
            : {}),
        }));

  if (columns.length === 0) {
    throw new Error(
      "The query returned no rows, so column names could not be inferred.",
    );
  }

  return createDataTableWidgetResult({
    widgetId: "analytics.db-admin.federated-read.v1",
    title: "Federated db admin result",
    summary: {
      sourceCount: sources.length,
      sources: sources.map((source) => ({
        sourceId: source.sourceId,
        connectionId: source.connectionId,
        rowCount: source.rows.length,
        columns: source.columns,
        truncated: source.truncated,
      })),
      ...(join
        ? {
            join: {
              kind: join.kind,
              leftSourceId: join.leftSourceId ?? sources[0].sourceId,
              leftColumn: join.leftColumn,
              rightSourceId: join.rightSourceId ?? sources[1].sourceId,
              rightColumn: join.rightColumn,
            },
          }
        : {}),
      limit,
      truncated: output.truncated,
    },
    display: {
      title: "Federated db admin result",
      description: join
        ? `${join.kind} join over ${sources
            .map((source) => source.sourceId)
            .join(" and ")}`
        : `Read ${sources[0].sourceId} from ${sources[0].connectionId}`,
    },
    table: {
      title: "Federated db admin result",
      columns,
      rows: output.rows.slice(0, limit),
      ...(output.truncated
        ? { sampledRows: limit, truncated: true }
        : { totalRows: output.rows.length }),
    },
  });
}
