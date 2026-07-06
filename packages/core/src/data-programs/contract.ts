/**
 * The data-program output contract.
 *
 * This module deliberately does NOT touch `../coding-tools/run-code.ts` —
 * `executeSandboxCode` already accepts arbitrary code, so a data program is
 * just user code with a small prelude prepended. The prelude defines a
 * frozen `params` global and a single-call `emit(rows, schema?)` that writes
 * one sentinel-prefixed JSON line to stdout. `parseDataProgramResult` then
 * extracts that line back out of the captured stdout (which may also contain
 * arbitrary `console.log` debug noise before/after it).
 */

export const DATA_PROGRAM_SENTINEL = "__DATA_PROGRAM_RESULT__";

export type DataProgramColumnType = "number" | "string" | "boolean" | "json";

export interface DataProgramColumn {
  name: string;
  type: string;
}

export type DataProgramContractErrorCode =
  | "emit_missing"
  | "emit_shape_invalid"
  | "result_too_large";

export interface DataProgramContractError {
  code: DataProgramContractErrorCode;
  message: string;
}

export interface ParsedDataProgramResult {
  rows: Record<string, unknown>[];
  schema: DataProgramColumn[];
  truncated: boolean;
}

/**
 * Build the JS source prepended to user code before it is handed to
 * `executeSandboxCode`. Defines:
 *   - a frozen `params` global (deep-frozen best-effort; primitives and
 *     plain JSON values are always frozen, so user code cannot mutate the
 *     params object out from under itself).
 *   - `emit(rows, schema?)` — single-call guard (a second call throws) that
 *     writes `DATA_PROGRAM_SENTINEL + JSON.stringify({rows, schema})` as one
 *     stdout line via `process.stdout.write`. Using `process.stdout.write`
 *     directly (not `console.log`) keeps the sentinel line byte-exact with
 *     no extra formatting, and on its own line so a naive `\n`-split still
 *     finds it even if user code itself never calls `console.log`.
 *
 * `console.log` remains completely free for debugging — the runner captures
 * combined stdout and only strips the sentinel line when parsing.
 */
export function buildDataProgramPrelude(
  params: Record<string, unknown> | undefined,
): string {
  const paramsJson = JSON.stringify(params ?? {});
  return [
    "// --- data-program prelude (framework-injected, do not edit) ---",
    `const params = Object.freeze(${paramsJson});`,
    "let __dataProgramEmitted = false;",
    "function emit(rows, schema) {",
    "  if (__dataProgramEmitted) {",
    "    throw new Error('emit() called more than once — a data program must call emit() exactly once.');",
    "  }",
    "  __dataProgramEmitted = true;",
    `  process.stdout.write(${JSON.stringify(DATA_PROGRAM_SENTINEL)} + JSON.stringify({ rows, schema }) + '\\n');`,
    "}",
    "// --- end prelude ---",
    "",
  ].join("\n");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function inferColumnType(value: unknown): DataProgramColumnType {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  return "json";
}

/**
 * Infer a column schema by surveying the first `sampleSize` rows. A column's
 * type is "json" if any sampled row disagrees on primitive type (the safe,
 * always-renderable fallback), otherwise the single agreed primitive type.
 * Columns absent from a row are simply not counted for that row.
 */
export function inferDataProgramSchema(
  rows: Record<string, unknown>[],
  sampleSize = 50,
): DataProgramColumn[] {
  const seen = new Map<string, Set<DataProgramColumnType>>();
  const order: string[] = [];
  for (const row of rows.slice(0, sampleSize)) {
    if (!isPlainObject(row)) continue;
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.set(key, new Set());
        order.push(key);
      }
      const value = row[key];
      if (value !== null && value !== undefined) {
        seen.get(key)!.add(inferColumnType(value));
      }
    }
  }
  return order.map((name) => {
    const types = seen.get(name)!;
    const type: DataProgramColumnType =
      types.size === 1
        ? (Array.from(types)[0] as DataProgramColumnType)
        : "json";
    return { name, type };
  });
}

function validateSchema(schema: unknown): schema is DataProgramColumn[] {
  if (!Array.isArray(schema)) return false;
  return schema.every(
    (entry) =>
      isPlainObject(entry) &&
      typeof entry.name === "string" &&
      typeof entry.type === "string",
  );
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/**
 * Find the LAST sentinel-prefixed line in captured stdout. Using the last
 * (not first) occurrence means accidental duplicate/partial sentinel text
 * inside earlier `console.log` debug output can't be mistaken for the real
 * result — the framework-injected `emit()` call is always what produced the
 * final one (the single-call guard rules out a legitimate second `emit()`).
 */
function extractSentinelLine(stdout: string): string | null {
  const lines = stdout.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line.startsWith(DATA_PROGRAM_SENTINEL)) {
      return line.slice(DATA_PROGRAM_SENTINEL.length);
    }
  }
  return null;
}

export interface ParseDataProgramResultOptions {
  maxRows: number;
  maxBytes: number;
}

export type ParseDataProgramResultOutcome =
  | { ok: true; result: ParsedDataProgramResult }
  | { ok: false; error: DataProgramContractError };

/**
 * Parse the sentinel-prefixed emit() payload out of captured sandbox stdout.
 * Never throws — always returns a discriminated outcome with a structured
 * error code so callers can surface something actionable instead of a bare
 * "Error: ..." string.
 */
export function parseDataProgramResult(
  stdout: string,
  options: ParseDataProgramResultOptions,
): ParseDataProgramResultOutcome {
  const sentinelPayload = extractSentinelLine(stdout);
  if (sentinelPayload === null) {
    return {
      ok: false,
      error: {
        code: "emit_missing",
        message:
          "The program did not call emit(rows, schema) — a data program must call emit() exactly once with its result rows.",
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(sentinelPayload);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "emit_shape_invalid",
        message: `emit() payload was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  if (!isPlainObject(parsed) || !Array.isArray((parsed as any).rows)) {
    return {
      ok: false,
      error: {
        code: "emit_shape_invalid",
        message:
          "emit() must be called as emit(rows, schema?) where rows is an array of plain objects.",
      },
    };
  }

  const rawRows = (parsed as any).rows as unknown[];
  if (!rawRows.every(isPlainObject)) {
    return {
      ok: false,
      error: {
        code: "emit_shape_invalid",
        message:
          "Every element of the emitted rows array must be a plain object.",
      },
    };
  }
  const rows = rawRows as Record<string, unknown>[];

  const rawSchema = (parsed as any).schema;
  let schema: DataProgramColumn[];
  if (rawSchema === undefined || rawSchema === null) {
    schema = inferDataProgramSchema(rows);
  } else if (validateSchema(rawSchema)) {
    schema = rawSchema;
  } else {
    return {
      ok: false,
      error: {
        code: "emit_shape_invalid",
        message:
          "emit()'s schema argument, when provided, must be an array of { name: string, type: string }.",
      },
    };
  }

  // Enforce caps by truncating rows to fit — an honest partial result
  // (`truncated: true`), never a silent drop. A single row that alone
  // exceeds the byte cap is a hard failure (result_too_large) since there is
  // nothing safe to truncate to.
  if (rows.length === 0) {
    return { ok: true, result: { rows, schema, truncated: false } };
  }

  const firstRowBytes = byteLength(JSON.stringify(rows[0]));
  if (firstRowBytes > options.maxBytes) {
    return {
      ok: false,
      error: {
        code: "result_too_large",
        message: `A single emitted row is ${firstRowBytes} bytes, exceeding the ${options.maxBytes}-byte cap. Reduce the row's field sizes (e.g. truncate long strings) before emitting.`,
      },
    };
  }

  let truncated = false;
  let kept = rows;
  if (rows.length > options.maxRows) {
    kept = rows.slice(0, options.maxRows);
    truncated = true;
  }

  let runningBytes = 0;
  let byteCutIndex = kept.length;
  for (let i = 0; i < kept.length; i += 1) {
    const rowBytes = byteLength(JSON.stringify(kept[i]));
    if (runningBytes + rowBytes > options.maxBytes) {
      byteCutIndex = i;
      break;
    }
    runningBytes += rowBytes;
  }
  if (byteCutIndex < kept.length) {
    kept = kept.slice(0, byteCutIndex);
    truncated = true;
  }

  return { ok: true, result: { rows: kept, schema, truncated } };
}
