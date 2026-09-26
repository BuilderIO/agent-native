import fs from "node:fs";
import path from "node:path";

import {
  IDENTITY_REKEY_COLUMNS,
  IDENTITY_REKEY_IGNORED_COLUMNS,
} from "../identity/rekey.js";
import { relPosix, walk } from "./scan-utils.js";
import type { GuardFinding, GuardResult } from "./types.js";

const IDENTITY_COLUMN =
  /^(?:email|[a-z0-9]+_email|[a-z0-9_]*scope_id|updated_by|invited_by|created_by|owner|principal_id|session_id|user_id)$/i;

interface ColumnUse {
  table: string;
  column: string;
  offset: number;
}

/** Ensure core schema identity columns are either rekeyed or explicitly non-identity. */
export function scanIdentityColumnsRegistered({
  root,
}: {
  root: string;
}): GuardResult {
  const name = "identity-columns-registered";
  const sourceRoot = path.join(root, "packages", "core", "src");
  if (!fs.existsSync(sourceRoot)) return { name, findings: [] };

  const registered = new Set(
    IDENTITY_REKEY_COLUMNS.map(({ table, column }) => `${table}.${column}`),
  );
  const findings: GuardFinding[] = [];
  for (const file of walk(sourceRoot)) {
    // Test fixtures may intentionally declare throwaway schemas. Production
    // stores and inline migrations live in ordinary *.ts files, so scope the
    // guard to every runtime source file rather than filename conventions.
    if (/(?:\.spec|\.test)\.tsx?$/i.test(file)) continue;
    const contents = fs.readFileSync(file, "utf8");
    for (const use of schemaColumns(contents)) {
      if (!IDENTITY_COLUMN.test(use.column)) continue;
      const identity = `${use.table}.${use.column}`;
      if (
        registered.has(identity) ||
        IDENTITY_REKEY_IGNORED_COLUMNS.has(identity)
      )
        continue;
      const line = contents.slice(0, use.offset).split("\n").length;
      findings.push({
        file: relPosix(root, file),
        line,
        message: `${use.table}.${use.column} looks identity-bearing but is not in identity/rekey.ts. Register it in IDENTITY_REKEY_COLUMNS with a safe mode, or add it to IDENTITY_REKEY_IGNORED_COLUMNS with a reason. A source pragma is not enough: offboarding and email change check the same registry at runtime.`,
      });
    }
  }
  return { name, findings };
}

function schemaColumns(contents: string): ColumnUse[] {
  const uses: ColumnUse[] = [];
  const tablePattern = /\b(?:pg)?table\s*\(\s*["']([^"']+)["']\s*,\s*\{/gi;
  for (const match of contents.matchAll(tablePattern)) {
    const table = match[1];
    const bodyStart = (match.index ?? 0) + match[0].length;
    const bodyEnd = matchingBrace(contents, bodyStart - 1);
    if (bodyEnd < 0) continue;
    const body = contents.slice(bodyStart, bodyEnd);
    const columnPattern =
      /\b([A-Za-z_$][\w$]*)\s*:\s*[A-Za-z_$][\w$]*\s*\(\s*["']([^"']+)["']/g;
    for (const column of body.matchAll(columnPattern)) {
      uses.push({
        table,
        column: column[2],
        offset: bodyStart + (column.index ?? 0),
      });
    }
  }

  const createTable =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["`]?([a-z_][\w]*)["`]?\s*\(/gi;
  for (const match of contents.matchAll(createTable)) {
    const table = match[1];
    const bodyStart = (match.index ?? 0) + match[0].length;
    const bodyEnd = matchingParenthesis(contents, bodyStart - 1);
    if (bodyEnd < 0) continue;
    const body = contents.slice(bodyStart, bodyEnd);
    const declaration =
      /^\s*["`]?([a-z_][\w]*)["`]?(?:\s+)(?:TEXT|VARCHAR|CHAR|BIGINT|INTEGER|INT|BOOLEAN|JSONB?|UUID)\b/gim;
    for (const column of body.matchAll(declaration)) {
      uses.push({
        table,
        column: column[1],
        offset: bodyStart + (column.index ?? 0),
      });
    }
  }

  const addedColumn =
    /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?["`]?([a-z_][\w]*)["`]?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([a-z_][\w]*)["`]?(?:\s+)(?:TEXT|VARCHAR|CHAR|BIGINT|INTEGER|INT|BOOLEAN|JSONB?|UUID)\b/gi;
  for (const match of contents.matchAll(addedColumn)) {
    uses.push({
      table: match[1],
      column: match[2],
      offset: match.index ?? 0,
    });
  }
  return uses;
}

function matchingBrace(source: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (char === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") quote = char;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return index;
  }
  return -1;
}

function matchingParenthesis(source: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (char === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") quote = char;
    else if (char === "(") depth++;
    else if (char === ")" && --depth === 0) return index;
  }
  return -1;
}
