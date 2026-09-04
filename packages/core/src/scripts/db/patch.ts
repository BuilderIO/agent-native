/**
 * Core script: db-patch
 *
 * Apply one or more precise edits to a text column in a PostgreSQL table.
 * Local execution uses PGlite and hosted execution uses PostgreSQL.
 */

import path from "node:path";

import { getDatabaseUrl, toPostgresParams } from "../../db/client.js";
import { parseArgs, fail } from "../utils.js";
import { createPostgresScriptClient } from "./postgres-client.js";
import {
  assertNoRawDbAccessControlPatchTarget,
  assertNoSensitiveFrameworkTables,
} from "./safety.js";
import { buildScopingPostgres } from "./scoping.js";

interface TextEdit {
  find: string;
  replace: string;
}

interface JsonOp {
  op: "set" | "replace" | "remove" | "move" | "move-before" | "insert";
  path?: string;
  from?: string;
  value?: unknown;
}

interface EditResult {
  index: number;
  status: "replaced" | "deleted" | "not-found";
  detail: string;
  occurrences: number;
}

interface PatchOutput {
  table: string;
  column: string;
  applied: number;
  total: number;
  bytesBefore: number;
  bytesAfter: number;
  results: EditResult[];
}

interface RunOptions {
  table: string;
  column: string;
  where: string;
  edits: TextEdit[];
  jsonOps?: JsonOp[];
  replaceAll: boolean;
  format?: string;
}

function isValidIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function validateWhere(where: string): void {
  if (where.includes(";")) fail("--where must not contain ';'");
  const stripped = where
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""')
    .toUpperCase();
  const blocked = [
    " INSERT ",
    " UPDATE ",
    " DELETE ",
    " DROP ",
    " ALTER ",
    " CREATE ",
    " TRUNCATE ",
    " GRANT ",
    " REVOKE ",
    "--",
    "/*",
  ];
  const padded = ` ${stripped} `;
  for (const keyword of blocked) {
    if (padded.includes(keyword)) {
      fail(`--where must not contain "${keyword.trim()}"`);
    }
  }
}

function parseEdits(parsed: Record<string, string>): TextEdit[] {
  let edits: TextEdit[];
  if (parsed.edits) {
    let value: unknown;
    try {
      value = JSON.parse(parsed.edits);
    } catch (error) {
      fail(
        `Invalid --edits JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!Array.isArray(value) || value.length === 0) {
      fail("--edits must be a non-empty JSON array of {find, replace} objects");
    }
    edits = value as TextEdit[];
  } else if (parsed.find !== undefined) {
    if (!parsed.find) fail("--find cannot be empty");
    edits = [{ find: parsed.find, replace: parsed.replace ?? "" }];
  } else {
    fail("Either --find/--replace or --edits is required");
  }

  for (const edit of edits) {
    if (typeof edit.find !== "string" || !edit.find) {
      fail("Each edit must have a non-empty 'find' string");
    }
    if (edit.replace == null) edit.replace = "";
    if (typeof edit.replace !== "string") {
      fail("Each edit's 'replace' field must be a string");
    }
  }
  return edits;
}

function parseJsonOps(parsed: Record<string, string>): JsonOp[] | null {
  const raw = parsed.jsonOps ?? parsed["json-ops"];
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    fail(
      `Invalid --json-ops JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(value) || value.length === 0) {
    fail("--json-ops must be a non-empty JSON array");
  }
  for (const op of value) {
    if (!op || typeof op !== "object" || typeof (op as any).op !== "string") {
      fail("Each JSON operation must have an op field");
    }
  }
  return value as JsonOp[];
}

function preview(value: string): string {
  const text = value.replace(/\s+/g, " ");
  return text.length > 60 ? `${text.slice(0, 60)}...` : text;
}

function parsePointer(pointer: string): string[] {
  if (pointer === "" || pointer === "/") return [];
  if (!pointer.startsWith("/"))
    fail(`JSON path must start with '/' (got: ${pointer})`);
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function resolveParent(
  root: unknown,
  segments: string[],
): [any, string | number] {
  if (segments.length === 0)
    fail("Root path is not supported for this operation");
  let node: any = root;
  for (let index = 0; index < segments.length - 1; index++) {
    const segment = segments[index];
    if (Array.isArray(node)) {
      const childIndex = Number.parseInt(segment, 10);
      if (
        !Number.isInteger(childIndex) ||
        childIndex < 0 ||
        childIndex >= node.length
      ) {
        fail(`Path segment "${segment}" is out of bounds`);
      }
      node = node[childIndex];
    } else if (node && typeof node === "object") {
      if (!(segment in node)) fail(`Path segment "${segment}" not found`);
      node = node[segment];
    } else {
      fail(`Cannot descend into ${typeof node} at segment "${segment}"`);
    }
  }
  const last = segments[segments.length - 1];
  if (Array.isArray(node)) {
    const index = last === "-" ? node.length : Number.parseInt(last, 10);
    if (!Number.isInteger(index) || index < 0 || index > node.length) {
      fail(`Expected a valid array index, got "${last}"`);
    }
    return [node, index];
  }
  return [node, last];
}

function applyJsonOp(root: any, op: JsonOp): string {
  switch (op.op) {
    case "set":
    case "replace": {
      if (op.path === undefined) fail(`${op.op} requires 'path'`);
      const [parent, key] = resolveParent(root, parsePointer(op.path));
      parent[key as any] = op.value;
      return `${op.op} ${op.path}`;
    }
    case "remove": {
      if (op.path === undefined) fail("remove requires 'path'");
      const [parent, key] = resolveParent(root, parsePointer(op.path));
      if (Array.isArray(parent)) parent.splice(key as number, 1);
      else delete parent[key as string];
      return `remove ${op.path}`;
    }
    case "insert": {
      if (op.path === undefined) fail("insert requires 'path'");
      const [parent, key] = resolveParent(root, parsePointer(op.path));
      if (!Array.isArray(parent)) fail("insert target must be an array");
      parent.splice(key as number, 0, op.value);
      return `insert at ${op.path}`;
    }
    case "move":
    case "move-before": {
      if (!op.from || op.path === undefined)
        fail(`${op.op} requires 'from' and 'path'`);
      const [fromParent, fromKey] = resolveParent(root, parsePointer(op.from));
      const value = Array.isArray(fromParent)
        ? fromParent.splice(fromKey as number, 1)[0]
        : fromParent[fromKey as string];
      if (!Array.isArray(fromParent)) delete fromParent[fromKey as string];
      let [toParent, toKey] = resolveParent(root, parsePointer(op.path));
      if (
        Array.isArray(toParent) &&
        Array.isArray(fromParent) &&
        toParent === fromParent &&
        (toKey as number) > (fromKey as number)
      ) {
        toKey = (toKey as number) - 1;
      }
      if (Array.isArray(toParent)) toParent.splice(toKey as number, 0, value);
      else toParent[toKey as string] = value;
      return `${op.op} ${op.from} -> ${op.path}`;
    }
    default:
      fail(`Unknown JSON operation: ${(op as any).op}`);
  }
}

function countOccurrences(value: string, find: string): number {
  let count = 0;
  let index = 0;
  while (find && (index = value.indexOf(find, index)) !== -1) {
    count++;
    index += find.length;
  }
  return count;
}

function findAll(value: string, find: string, limit = 10): number[] {
  const positions: number[] = [];
  let index = 0;
  while (
    find &&
    positions.length < limit &&
    (index = value.indexOf(find, index)) !== -1
  ) {
    positions.push(index);
    index += find.length;
  }
  return positions;
}

function formatContext(
  content: string,
  matchIndex: number,
  matchLength: number,
  radius = 40,
): string {
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(content.length, matchIndex + matchLength + radius);
  const before = content.slice(start, matchIndex).replace(/\s+/g, " ");
  const middle = content
    .slice(matchIndex, matchIndex + matchLength)
    .replace(/\s+/g, " ");
  const after = content
    .slice(matchIndex + matchLength, end)
    .replace(/\s+/g, " ");
  return `${start > 0 ? "…" : ""}${before}⟨${middle}⟩${after}${end < content.length ? "…" : ""}`;
}

function buildAmbiguousMessage(
  find: string,
  content: string,
  occurrences: number,
): string {
  const positions = findAll(content, find, 6);
  const lines = [
    `Found ${occurrences} occurrences of the 'find' string — db-patch requires exactly one match by default.`,
    `Widen 'find' with unique surrounding context, or pass --all to replace every occurrence.`,
    `'find' preview: "${preview(find)}"`,
    "Matches:",
  ];
  for (let index = 0; index < positions.length; index++) {
    lines.push(
      `  [${index + 1}] ${formatContext(content, positions[index], find.length)}`,
    );
  }
  if (occurrences > positions.length) {
    lines.push(`  … and ${occurrences - positions.length} more`);
  }
  return lines.join("\n");
}

function applyEdits(
  content: string,
  edits: TextEdit[],
  replaceAll: boolean,
): { content: string; results: EditResult[]; applied: number } {
  let output = content;
  const results: EditResult[] = [];
  let applied = 0;
  for (let index = 0; index < edits.length; index++) {
    const edit = edits[index];
    const occurrences = countOccurrences(output, edit.find);
    if (occurrences === 0) {
      results.push({
        index,
        status: "not-found",
        detail: `NOT FOUND: "${preview(edit.find)}"`,
        occurrences,
      });
      continue;
    }
    if (!replaceAll && occurrences > 1) {
      results.push({
        index,
        status: "not-found",
        detail: buildAmbiguousMessage(edit.find, output, occurrences),
        occurrences,
      });
      continue;
    }
    output = replaceAll
      ? output.split(edit.find).join(edit.replace)
      : output.replace(edit.find, edit.replace);
    applied++;
    results.push({
      index,
      status: edit.replace ? "replaced" : "deleted",
      detail: `${edit.replace ? "replaced" : "deleted"}: "${preview(edit.find)}"`,
      occurrences,
    });
  }
  return { content: output, results, applied };
}

function applyEditsToValue(original: string, options: RunOptions) {
  if (!options.jsonOps?.length) {
    const result = applyEdits(original, options.edits, options.replaceAll);
    return { ...result, total: options.edits.length };
  }
  let root: unknown;
  try {
    root = JSON.parse(original);
  } catch (error) {
    fail(
      `--json-ops requires the column value to be valid JSON. Parse failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const results: EditResult[] = [];
  let applied = 0;
  for (let index = 0; index < options.jsonOps.length; index++) {
    try {
      results.push({
        index,
        status: "replaced",
        detail: applyJsonOp(root, options.jsonOps[index]),
        occurrences: 1,
      });
      applied++;
    } catch (error) {
      results.push({
        index,
        status: "not-found",
        detail: `FAILED: ${error instanceof Error ? error.message : String(error)}`,
        occurrences: 0,
      });
    }
  }
  return {
    content: JSON.stringify(root),
    results,
    applied,
    total: options.jsonOps.length,
  };
}

function printResult(output: PatchOutput, format?: string): void {
  if (format === "json") {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  console.log(`db-patch: ${output.table}.${output.column}`);
  console.log(`  Applied: ${output.applied}/${output.total}`);
  console.log(`  Bytes:   ${output.bytesBefore} -> ${output.bytesAfter}`);
  for (const result of output.results) console.log(`  - ${result.detail}`);
}

export default async function dbPatch(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  if (parsed.help === "true") {
    console.log(`Usage: pnpm action db-patch --table <t> --column <c> --where "<clause>" [options]

Required:
  --table <name>       Target table identifier
  --column <name>      Target text column identifier
  --where "<clause>"  Clause that matches exactly one row
  --find <text>        Text to find
  --replace <text>     Replacement text
  --edits <json>       Batch of {find, replace} objects
  --json-ops <json>    Structural JSON edits

Options:
  --all                Replace every occurrence
  --format json        Output as JSON
  --db <path>          PGlite data directory (default: data/pglite)
  --help               Show this help message`);
    return;
  }

  const table = parsed.table;
  const column = parsed.column;
  const where = parsed.where;
  if (!table) fail("--table is required");
  if (!column) fail("--column is required");
  if (!where) fail("--where is required");
  if (!isValidIdentifier(table) || !isValidIdentifier(column)) {
    fail("--table and --column must be plain identifiers");
  }
  validateWhere(where);
  assertNoSensitiveFrameworkTables(table, "patch");
  assertNoRawDbAccessControlPatchTarget(table, column);
  assertNoSensitiveFrameworkTables(where, "read");

  const jsonOps = parseJsonOps(parsed);
  const options: RunOptions = {
    table,
    column,
    where,
    edits: jsonOps ? [] : parseEdits(parsed),
    jsonOps: jsonOps ?? undefined,
    replaceAll: parsed.all === "true",
    format: parsed.format,
  };
  const url = parsed.db
    ? `pglite:${path.resolve(parsed.db)}`
    : getDatabaseUrl("pglite:./data/pglite");
  const client = await createPostgresScriptClient(url);

  try {
    let output: PatchOutput | undefined;
    await client.begin(async (tx) => {
      const scoping = await buildScopingPostgres(tx);
      for (const statement of scoping.setup) await tx.unsafe(statement);
      try {
        const selectSql = `SELECT "${column}" AS __val FROM "${table}" WHERE ${where}`;
        const selected = await tx.unsafe(selectSql);
        if (selected.length === 0) {
          fail(
            `No rows matched: ${table} WHERE ${where}. ` +
              "(Database scoping filters results to the current user; the row may exist but be owned by someone else.)",
          );
        }
        if (selected.length > 1) {
          fail(
            `WHERE matched ${selected.length} rows in ${table}. db-patch expects exactly one row — narrow the WHERE clause (usually by primary key).`,
          );
        }
        const original = selected[0].__val;
        if (typeof original !== "string") {
          fail(
            `Column ${table}.${column} is not a text column (got ${typeof original}).`,
          );
        }
        const edited = applyEditsToValue(original, options);
        if (edited.applied > 0) {
          await tx.unsafe(
            toPostgresParams(
              `UPDATE "${table}" SET "${column}" = ? WHERE ${where}`,
            ),
            [edited.content],
          );
        }
        output = {
          table,
          column,
          applied: edited.applied,
          total: edited.total,
          bytesBefore: original.length,
          bytesAfter: edited.content.length,
          results: edited.results,
        };
      } finally {
        for (const statement of scoping.teardown) {
          await tx.unsafe(statement).catch(() => {});
        }
      }
    });
    if (output) printResult(output, options.format);
  } finally {
    await client.end();
  }
}
