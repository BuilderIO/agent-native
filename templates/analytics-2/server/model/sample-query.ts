import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

import type { CellOutput } from "../../app/lib/model/contracts.js";
import {
  sampleTable,
  sampleTables,
  type SampleTable,
} from "../../app/lib/model/sample-data.js";
import { SAMPLE_QUERY_MAX_WORKERS } from "../../shared/sample-data-contract.js";

/**
 * True when the statement names one of the bundled sample tables, even when the
 * statement is outside the evaluable subset (a join, an aggregate). The caller
 * uses it to say the sample data cannot run the query instead of asking for a
 * warehouse connection a simple sample query would not need.
 */
export function namesSampleTable(source: string): boolean {
  const sql = source
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!sql) return false;
  return sampleTables().some((table) =>
    new RegExp(
      `\\b(?:from|join)\\s+(?:"?public"?\\.)?"?${table.name}"?(?![\\w.])`,
    ).test(sql),
  );
}

/**
 * A new workspace opens with sample projects whose SQL cells name one of the
 * bundled sample tables (`orders`, `customers`, `products`, `sessions`) and carry
 * no warehouse connection, because a brand-new account has none. Without a
 * fallback those cells answer "select a data connection" and the first thing a
 * new person clicks cannot run at all.
 *
 * This evaluates the small, declared subset of SQL the samples actually use:
 *
 *   select <column>[, <column>]* | *  from <sample table>
 *     [ where <column> = <literal> ]
 *     [ order by <column> [asc|desc] ]
 *     [ limit <n> ]
 *
 * Anything else returns null, so a real warehouse query is never silently
 * answered from sample data.
 */
export function sampleQuery(source: string): {
  output: Extract<CellOutput, { type: "table" }>;
} | null {
  const sql = source
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = sql.match(
    /^select\s+(?<columns>\*|[\w."\s,]+?)\s+from\s+(?:public\.)?(?<table>[a-z_][\w]*)\s*(?<rest>.*)$/i,
  );
  if (!match?.groups) return null;
  const table = sampleTable(match.groups.table!.toLowerCase());
  if (!table) return null;
  // Clauses are consumed in SQL's own order (where, order by, limit) so a query
  // that carries only an ordering is not mistaken for an unsupported statement.
  let rest = (match.groups.rest ?? "").trim();
  const where = rest.match(
    /^where\s+(?<column>[a-z_][\w]*)\s*=\s*(?:'(?<text>[^']*)'|(?<number>-?\d+(?:\.\d+)?))\s*/i,
  );
  if (where) rest = rest.slice(where[0].length).trim();
  else if (/^where\b/i.test(rest)) return null;
  const order = rest.match(
    /^order\s+by\s+(?<column>[a-z_][\w]*)(?:\s+(?<direction>asc|desc))?\s*/i,
  );
  if (order) rest = rest.slice(order[0].length).trim();
  else if (/^order\b/i.test(rest)) return null;
  const limit = rest.match(/^limit\s+(?<count>\d+)\s*$/i);
  if (limit) rest = "";
  if (rest !== "") return null;

  const available = table.columns.map((column) => column.name);
  const requested =
    match.groups.columns!.trim() === "*"
      ? available
      : match.groups
          .columns!.split(",")
          .map((column) => column.trim().replace(/"/g, "").toLowerCase())
          .filter(Boolean);
  const indexOf = (name: string) => available.indexOf(name);
  if (requested.some((column) => indexOf(column) < 0)) return null;

  let rows = table.rows.map((row) => [...row]);
  const whereColumn = where?.groups?.column;
  if (whereColumn) {
    const index = indexOf(whereColumn.toLowerCase());
    if (index < 0) return null;
    const expected =
      where!.groups!.text !== undefined
        ? where!.groups!.text
        : Number(where!.groups!.number);
    rows = rows.filter((row) => row[index] === expected);
  }
  const orderColumn = order?.groups?.column;
  if (orderColumn) {
    const index = indexOf(orderColumn.toLowerCase());
    if (index < 0) return null;
    const direction = (order!.groups!.direction ?? "asc").toLowerCase();
    rows = [...rows].sort((left, right) => {
      const a = left[index];
      const b = right[index];
      if (a === b) return 0;
      if (a === null) return -1;
      if (b === null) return 1;
      const compared = a! < b! ? -1 : 1;
      return direction === "desc" ? -compared : compared;
    });
  }
  const limitCount = limit?.groups?.count ? Number(limit.groups.count) : null;
  if (limitCount !== null) rows = rows.slice(0, limitCount);

  const indexes = requested.map((column) => indexOf(column));
  const projected = rows.map((row) =>
    indexes.map((index) => row[index] ?? null),
  );
  const columns = indexes.map((index) => ({
    name: available[index]!,
    type: table.columns[index]!.type,
  }));
  return {
    output: {
      type: "table",
      columns: columns.map((column) => ({
        name: column.name,
        type:
          column.type === "number"
            ? "number"
            : column.type === "boolean"
              ? "boolean"
              : column.type === "date"
                ? "date"
                : "string",
      })),
      rows: projected,
      rowCount: projected.length,
      truncated: false,
    },
  };
}

// PGlite executes WASM synchronously, so its statement_timeout cannot interrupt
// a running query. The parent owns the deadline and terminates this worker.
const sampleWorkerSource = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const { PGlite } = await import(workerData.moduleUrl);
  const db = new PGlite({ parsers: { 1082: value => value, 114: value => value, 3802: value => value } });
  try {
    const types = { string: "text", number: "numeric", boolean: "boolean", date: "date", datetime: "timestamp", null: "text" };
    await db.exec('CREATE SCHEMA "PUBLIC"');
    const ident = value => '"' + value.replace(/"/g, '""') + '"';
    for (const table of workerData.tables) {
      const columns = table.columns.map(column => ident(column.name) + " " + (column.type === "number" && column.sqlType === "float" ? "double precision" : types[column.type])).join(", ");
      await db.exec('CREATE TABLE ' + ident(table.name) + ' (' + columns + ')');
      const batchSize = Math.max(1, Math.min(1000, Math.floor(60000 / table.columns.length)));
      for (let start = 0; start < table.rows.length; start += batchSize) {
        const rows = table.rows.slice(start, start + batchSize);
        const values = rows.flat();
        let parameter = 0;
        const placeholders = rows.map(row => '(' + row.map(() => '$' + ++parameter).join(', ') + ')');
        await db.query('INSERT INTO ' + ident(table.name) + ' VALUES ' + placeholders.join(', '), values);
      }
      await db.exec('CREATE VIEW "PUBLIC".' + ident(table.name) + ' AS SELECT * FROM public.' + ident(table.name));
    }
    await db.exec("BEGIN READ ONLY");
    const prefix = 'SELECT * FROM (';
    const suffix = '\n) AS sample_result LIMIT 10001';
    const result = await db.query(prefix + workerData.sql + suffix, workerData.parameters, { rowMode: "array" }).catch(error => {
      if (typeof error.message === "string")
        error.message = error.message.split(suffix).join("").split(prefix).join("");
      const position = Number(error.position);
      if (Number.isSafeInteger(position) && position > prefix.length && /^(42|22)/.test(error.code)) {
        const source = Array.from(workerData.sql);
        const offset = position - prefix.length - 1;
        if (error.code === "42601" && offset >= source.length)
          error.message = "syntax error at end of input";
        const lines = source.slice(0, offset).join("").split('\n');
        const line = lines.length;
        const column = Array.from(lines[line - 1]).length + 1;
        error.message += ' at [' + line + ':' + column + ']';
      }
      throw error;
    });
    parentPort.postMessage({ result });
  } catch (error) {
    parentPort.postMessage({ error: { code: typeof error.code === "string" ? error.code : null, message: error.message } });
  } finally { await db.close(); }
})().catch(() => parentPort.postMessage({ error: { code: null } }));
`;

let activeSampleWorkers = 0;

const NUMERIC_TYPE_IDS = [20, 21, 23, 700, 701, 1700];

function isExactDouble(text: string): boolean {
  if (!Number.isFinite(Number(text)) || !/^-?\d+(?:\.\d+)?$/.test(text))
    return false;
  const [whole = "", fraction] = text.replace(/^-/, "").split(".");
  const digits = (whole + (fraction?.replace(/0+$/, "") ?? "")).replace(
    /^0+/,
    "",
  );
  return digits.length <= 15;
}

function firstStatementSeparator(text: string): number {
  let quote: string | null = null;
  let dollarTag: string | null = null;
  let end = -1;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (dollarTag) {
      if (text.startsWith(dollarTag, i)) {
        i += dollarTag.length - 1;
        dollarTag = null;
      }
    } else if (quote) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "$") {
      const match = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i));
      if (match) {
        dollarTag = match[0];
        i += dollarTag.length - 1;
      }
    } else if (text.startsWith("--", i)) {
      const newline = text.indexOf("\n", i);
      if (newline < 0) break;
      i = newline;
    } else if (text.startsWith("/*", i)) {
      const close = text.indexOf("*/", i + 2);
      if (close < 0) break;
      i = close + 1;
    } else if (char === ";") {
      end = i;
      break;
    }
  }
  return end;
}

export function stripStatementTerminator(source: string): string {
  const text = source.trim();
  const end = firstStatementSeparator(text);
  if (end < 0) return text.replace(/;\s*$/, "");
  const tail = text.slice(end).replace(/;|\s+|--[^\n]*|\/\*[\s\S]*?\*\//g, "");
  return tail === "" ? text.slice(0, end).trim() : text;
}

/** Run read-only SQL in an isolated, deadline-bound demo database. */
export async function executeSampleQuery(
  source: string,
  parameters: (string | number | null)[] = [],
  builtin = false,
  signal?: AbortSignal,
): Promise<ReturnType<typeof sampleQuery>> {
  signal?.throwIfAborted();
  if (!source.trim())
    return {
      output: {
        type: "table",
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
      },
    };
  const simple = parameters.length ? null : sampleQuery(source);
  if (simple) return simple;
  const sql = stripStatementTerminator(source);
  if (builtin || namesSampleTable(sql))
    return executeSampleTablesQuery(sql, sampleTables(), parameters, signal);
  try {
    return await executeSampleTablesQuery(sql, [], parameters, signal);
  } catch (error) {
    if (namesMissingRelation(error)) return null;
    throw error;
  }
}

function namesMissingRelation(error: unknown) {
  const sqlState =
    error instanceof Error && "sqlState" in error ? error.sqlState : undefined;
  return sqlState === "42P01" || sqlState === "3F000";
}

/** Execute SQL using only explicitly supplied bundled-sample-derived tables. */
export async function executeSampleTablesQuery(
  source: string,
  tables: SampleTable[],
  parameters: (string | number | null)[] = [],
  signal?: AbortSignal,
): Promise<ReturnType<typeof sampleQuery>> {
  signal?.throwIfAborted();
  const sql = stripStatementTerminator(source);
  if (firstStatementSeparator(sql) >= 0) {
    throw Object.assign(
      new Error("Only one SQL statement can run at a time."),
      {
        actionContractError: true,
        errorCode: "project_sample_query_failed",
        statusCode: 422,
      },
    );
  }
  if (activeSampleWorkers >= SAMPLE_QUERY_MAX_WORKERS) {
    throw Object.assign(
      new Error("The sample query service is busy. Try again."),
      {
        actionContractError: true,
        errorCode: "project_sample_query_busy",
        statusCode: 503,
      },
    );
  }
  activeSampleWorkers++;
  const lease = { released: true };
  try {
    const moduleUrl = createRequire(import.meta.url).resolve(
      "@electric-sql/pglite",
    );
    const result = await new Promise<{
      fields: { name: string; dataTypeID: number }[];
      rows: unknown[][];
    } | null>((resolve, reject) => {
      // raw-sql-ok: User SQL executes only in the isolated read-only demo worker, never the app or credentialed database.
      const worker = new Worker(sampleWorkerSource, {
        eval: true,
        workerData: { moduleUrl, sql, tables, parameters },
        resourceLimits: { maxOldGenerationSizeMb: 128 },
      });
      let terminating = false;
      const finish = (settle: () => void) => {
        if (terminating) return;
        terminating = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        void worker.terminate().then(settle, (error) => {
          lease.released = false;
          reject(error);
        });
      };
      const abort = () => finish(() => reject(signal?.reason));
      // Includes database startup and sample loading as well as query execution.
      const timer = setTimeout(
        () =>
          finish(() =>
            reject(
              Object.assign(new Error("The sample query timed out."), {
                actionContractError: true,
                errorCode: "project_sample_query_timeout",
                statusCode: 504,
              }),
            ),
          ),
        15000,
      );
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      worker.once(
        "message",
        (message: {
          result?: {
            fields: { name: string; dataTypeID: number }[];
            rows: unknown[][];
          };
          error?: { code: string | null; message?: string };
        }) =>
          finish(() => {
            if (message.result) resolve(message.result);
            else
              reject(
                Object.assign(
                  new Error(
                    message.error?.code && /^(42|22)/.test(message.error.code)
                      ? message.error.message
                      : "The sample query could not be executed.",
                  ),
                  {
                    actionContractError: true,
                    errorCode: "project_sample_query_failed",
                    sqlState: message.error?.code,
                    statusCode: 422,
                  },
                ),
              );
          }),
      );
      worker.once("error", (error) => finish(() => reject(error)));
      worker.once("exit", (code) =>
        finish(() =>
          reject(
            new Error(`The sample query worker exited unexpectedly (${code}).`),
          ),
        ),
      );
    });
    if (!result) return null;
    const numericField = (index: number) =>
      NUMERIC_TYPE_IDS.includes(result.fields[index]?.dataTypeID ?? 0);
    const rows = result.rows.slice(0, 10000).map((row) =>
      row.map((value, index) => {
        if (
          result.fields[index]?.dataTypeID === 1700 &&
          typeof value === "string"
        ) {
          const number = Number(value);
          return /^-?\d+$/.test(value) && Number.isSafeInteger(number)
            ? number
            : value;
        }
        if (typeof value === "number" && !Number.isFinite(value))
          return String(value);
        if (
          value === null ||
          typeof value === "boolean" ||
          typeof value === "number" ||
          typeof value === "string"
        )
          return value;
        if (value instanceof Date) return value.toISOString();
        if (typeof value === "bigint")
          return value <= BigInt(Number.MAX_SAFE_INTEGER) &&
            value >= BigInt(Number.MIN_SAFE_INTEGER)
            ? Number(value)
            : value.toString();
        if (value instanceof Uint8Array)
          return `\\x${Buffer.from(value).toString("hex")}`;
        if (typeof value === "object")
          return JSON.stringify(value, (_key, nested) =>
            typeof nested === "bigint" ? nested.toString() : nested,
          );
        throw new Error("Unsupported sample query result type");
      }),
    );
    const textual = new Set<number>();
    result.fields.forEach((_field, index) => {
      if (
        numericField(index) &&
        rows.some((row) => {
          const value = row[index];
          return typeof value === "string" && !isExactDouble(value);
        })
      )
        textual.add(index);
    });
    for (const row of rows)
      for (const index of textual)
        if (row[index] !== null) row[index] = String(row[index]);
    return {
      output: {
        type: "table",
        columns: result.fields.map((field, index) => ({
          name: field.name,
          type: textual.has(index)
            ? ("string" as const)
            : NUMERIC_TYPE_IDS.includes(field.dataTypeID)
              ? ("number" as const)
              : field.dataTypeID === 16
                ? ("boolean" as const)
                : field.dataTypeID === 1082
                  ? ("date" as const)
                  : [1114, 1184].includes(field.dataTypeID)
                    ? ("datetime" as const)
                    : ("string" as const),
        })),
        rows,
        rowCount: rows.length,
        truncated: result.rows.length > rows.length,
      },
    };
  } finally {
    if (lease.released) activeSampleWorkers--;
  }
}
