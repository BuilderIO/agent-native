#!/usr/bin/env node
/**
 * guard-no-unbounded-table-reads.mjs
 *
 * Database transfer is billed per byte returned, so a read with no WHERE and
 * no LIMIT costs the whole table on every call, and the calls that matter are
 * the hot ones. `getAllSettings()` ran `SELECT key, value FROM public.settings`
 * (~133k rows, 14 MB) several times a second from the MCP config merge and hub
 * server listing; Neon billed ~170 TB of transfer in one month across the
 * featured apps, 90 TB of it from Docs alone. Slides had already paid for the
 * same shape: the collab cold-start seed ran `SELECT doc_id FROM _collab_docs`
 * and `SELECT id, data FROM decks` (full deck JSON, ~50 KB a row) until #5188
 * made seeding lazy. guard-no-heavy-dashboard-list-reads only knows
 * schema.dashboards and guard-no-boot-data-work only knows plugin startup
 * bodies, so neither saw any of it.
 *
 * This guard only scans lines ADDED on this branch (via
 * scripts/lib/changed-lines.mjs) in server-side code, and flags:
 *   - any call to getAllSettings(), which reads every settings row
 *   - a raw SQL string or template literal that SELECTs FROM a table with no
 *     WHERE and no LIMIT anywhere in the literal; a select list made only of
 *     COUNT/MAX/MIN/SUM/AVG, `1`, or EXISTS returns one row and passes
 *   - a Drizzle `.select(...).from(x)` chain with no `.where(` or `.limit(`;
 *     `.$dynamic()` alone does not bound a query
 *
 * Files are parsed with the TypeScript compiler instead of matched by line,
 * because both query shapes span lines: a SQL literal wraps, and a Drizzle
 * chain puts `.from(` and `.where(` on different lines. An added line anywhere
 * inside the literal or statement re-evaluates the whole of it.
 *
 * Known limitation, stated so a pass is not misread as coverage: SQL assembled
 * by `+` concatenation and Drizzle's relational `findMany()` are not read.
 *
 * If the whole-table read is intentional and reviewed (a bounded config table,
 * a scheduled job), say so on the line or the line immediately above it:
 *
 *   // guard:allow-unbounded-read — short reason
 *
 * Same diff-base contract as every guard built on changed-lines.mjs: if the
 * base cannot be resolved the guard exits GUARD_EXIT_COULD_NOT_RUN, which
 * run-guards.ts reports as SKIPPED, because a silent pass would look
 * identical to a real clean run.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import {
  GUARD_EXIT_COULD_NOT_RUN,
  requireAddedLines,
} from "./lib/changed-lines.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const PRAGMA = /(?:\/\/|\/\*)\s*guard:allow-unbounded-read\b/;

const IN_SCOPE =
  /^(?:packages\/[^/]+\/src\/|templates\/[^/]+\/(?:server|actions)\/|apps\/[^/]+\/(?:server|actions)\/)/;
const SKIPPED =
  /(\.spec\.|\.test\.|\/__tests__\/|\/dist\/|\/node_modules\/|\/client\/)/;
const SOURCE_FILE = /\.[cm]?[jt]s$/;

const DRIZZLE_SELECT = new Set([
  "select",
  "selectDistinct",
  "selectDistinctOn",
]);
// Accept conventional upper- or lowercase SQL without matching prose such as
// "Select a file from…" inside a template literal.
const SQL_LEAD = /^[\s(]*(?:SELECT|WITH|select|with)\b/;
const SINGLE_ROW_ITEM =
  /^(?:(?:COALESCE|CAST)\s*\(\s*)*(?:(?:COUNT|MAX|MIN|SUM|AVG)\s*\(|(?:NOT\s+)?EXISTS\s*\(|1\b)/i;
const TABLE =
  /^\s*((?:"[^"]+"|\$\{[^}]*\}|[\w$]+)(?:\.(?:"[^"]+"|\$\{[^}]*\}|[\w$]+))*)/;
const STATEMENT_PARENTS = new Set([
  ts.SyntaxKind.SourceFile,
  ts.SyntaxKind.Block,
  ts.SyntaxKind.ModuleBlock,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.DefaultClause,
]);

export function findUnboundedTableReadViolations(
  file,
  source,
  addedLineNumbers,
) {
  if (!inScope(file)) return [];

  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const lines = source.split("\n");
  const lineOf = (pos) =>
    sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
  const violations = [];

  const visit = (node) => {
    const match = inspect(node, sourceFile);
    if (match) {
      const start = lineOf(match.range.getStart(sourceFile));
      const end = lineOf(match.range.getEnd());
      let added = false;
      for (let line = start; line <= end && !added; line += 1) {
        added = addedLineNumbers.has(line);
      }
      const opted = lines
        .slice(Math.max(0, start - 2), end)
        .some((line) => PRAGMA.test(line));
      if (added && !opted) {
        violations.push({
          file,
          line: lineOf(node.getStart(sourceFile)),
          kind: match.kind,
          snippet: match.snippet,
          reason: match.reason,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return violations;
}

function inspect(node, sourceFile) {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : null;

    if (name === "getAllSettings") {
      return {
        kind: "getAllSettings",
        range: node,
        snippet: "getAllSettings()",
        reason:
          "reads every settings row; use getSetting or a bounded listSettingsByPrefix read",
      };
    }

    if (
      name === "from" &&
      ts.isPropertyAccessExpression(callee) &&
      chainHasSelect(callee.expression)
    ) {
      const statement = enclosingStatement(node);
      if (drizzleChainIsBounded(node)) return null;
      return {
        kind: "drizzle",
        range: statement,
        snippet: collapse(node.getText(sourceFile)),
        reason: "Drizzle select has no .where() or .limit() in its statement",
      };
    }
    return null;
  }

  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
  ) {
    const snippet = unboundedSelect(node.getText(sourceFile).slice(1, -1));
    if (!snippet) return null;
    return {
      kind: "sql",
      range: node,
      snippet,
      reason: "SQL select has no WHERE or LIMIT",
    };
  }

  return null;
}

function unboundedSelect(sql) {
  const sanitized = stripSqlStringsAndComments(sql);
  let statementStart = 0;
  while (statementStart < sql.length) {
    const semicolon = sanitized.indexOf(";", statementStart);
    const statementEnd = semicolon === -1 ? sql.length : semicolon;
    const statement = sanitized.slice(statementStart, statementEnd);
    if (SQL_LEAD.test(statement)) {
      const rawStatement = sql.slice(statementStart, statementEnd);
      for (const select of statement.matchAll(/\bSELECT\b/gi)) {
        const listStart = select.index + select[0].length;
        const selectEnd = selectBranchEnd(statement, select.index);
        const from = topLevelFrom(statement, listStart);
        if (!from || from.index >= selectEnd) continue;
        const branch = statement.slice(select.index, selectEnd);
        if (hasTopLevelBound(branch)) continue;
        const list = rawStatement.slice(listStart, from.index);
        if (
          !hasTopLevelGroupBy(branch) &&
          splitTopLevel(list).every((item) => SINGLE_ROW_ITEM.test(item))
        ) {
          continue;
        }
        const table = TABLE.exec(
          rawStatement.slice(from.index + from.length, selectEnd),
        )?.[1];
        if (!table) continue;
        return collapse(`SELECT ${list.trim()} FROM ${table}`);
      }
    }
    statementStart = statementEnd + 1;
  }
  return null;
}

function selectBranchEnd(statement, selectStart) {
  let depth = 0;
  const token = /[()]|\b(?:UNION|INTERSECT|EXCEPT)\b/gi;
  token.lastIndex = selectStart;
  for (
    let match = token.exec(statement);
    match;
    match = token.exec(statement)
  ) {
    if (match[0] === "(") {
      depth += 1;
    } else if (match[0] === ")") {
      if (depth === 0) return match.index;
      depth -= 1;
    } else if (depth === 0) {
      return match.index;
    }
  }
  return statement.length;
}

function hasTopLevelBound(branch) {
  let depth = 0;
  const token = /[()]|\b(?:WHERE|LIMIT)\b/gi;
  for (const match of branch.matchAll(token)) {
    if (match[0] === "(") depth += 1;
    else if (match[0] === ")") depth -= 1;
    else if (depth === 0) return true;
  }
  return false;
}

function hasTopLevelGroupBy(branch) {
  let depth = 0;
  const token = /[()]|\bGROUP\b/gi;
  for (const match of branch.matchAll(token)) {
    if (match[0] === "(") depth += 1;
    else if (match[0] === ")") depth -= 1;
    else if (
      depth === 0 &&
      /^\s+BY\b/i.test(branch.slice(match.index + match[0].length))
    ) {
      return true;
    }
  }
  return false;
}

function stripSqlStringsAndComments(sql) {
  const output = [...sql];
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];
    if (char === "-" && next === "-") {
      while (index < sql.length && sql[index] !== "\n") output[index++] = " ";
      continue;
    }
    if (char === "/" && next === "*") {
      output[index++] = " ";
      output[index++] = " ";
      while (
        index < sql.length &&
        !(sql[index] === "*" && sql[index + 1] === "/")
      ) {
        if (sql[index] !== "\n") output[index] = " ";
        index += 1;
      }
      if (index < sql.length) {
        output[index++] = " ";
        output[index++] = " ";
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      const quote = char;
      output[index++] = " ";
      while (index < sql.length) {
        if (sql[index] === "\\") {
          output[index++] = " ";
          if (index < sql.length) output[index++] = " ";
        } else if (sql[index] === quote) {
          output[index++] = " ";
          if (sql[index] === quote) output[index++] = " ";
          else break;
        } else {
          if (sql[index] !== "\n") output[index] = " ";
          index += 1;
        }
      }
      continue;
    }
    index += 1;
  }
  return output.join("");
}

function topLevelFrom(sql, start) {
  let depth = 0;
  const token = /[()]|\bFROM\b/gi;
  token.lastIndex = start;
  for (let match = token.exec(sql); match; match = token.exec(sql)) {
    if (match[0] === "(") depth += 1;
    else if (match[0] === ")") depth -= 1;
    else if (depth === 0)
      return { index: match.index, length: match[0].length };
    if (depth < 0) return null;
  }
  return null;
}

function splitTopLevel(list) {
  const items = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < list.length; index += 1) {
    const char = list[index];
    if (char === "(" || char === "{") depth += 1;
    else if (char === ")" || char === "}") depth -= 1;
    else if (char === "," && depth === 0) {
      items.push(list.slice(start, index).trim());
      start = index + 1;
    }
  }
  items.push(list.slice(start).trim());
  return items;
}

function chainHasSelect(node) {
  while (
    ts.isCallExpression(node) ||
    ts.isPropertyAccessExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    if (
      ts.isPropertyAccessExpression(node) &&
      DRIZZLE_SELECT.has(node.name.text)
    ) {
      return true;
    }
    node = node.expression;
  }
  return false;
}

function drizzleChainIsBounded(node) {
  let current = node;
  while (current.parent) {
    const property = current.parent;
    if (
      ts.isPropertyAccessExpression(property) &&
      property.expression === current &&
      ts.isCallExpression(property.parent) &&
      property.parent.expression === property
    ) {
      if (["where", "limit"].includes(property.name.text)) {
        return true;
      }
      current = property.parent;
      continue;
    }
    break;
  }
  return false;
}

function enclosingStatement(node) {
  let current = node;
  while (
    current.parent &&
    !STATEMENT_PARENTS.has(current.parent.kind) &&
    !(ts.isArrowFunction(current.parent) && current.parent.body === current)
  ) {
    current = current.parent;
  }
  return current;
}

function collapse(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 117)}...` : flat;
}

function inScope(relPath) {
  if (SKIPPED.test(relPath) || !SOURCE_FILE.test(relPath)) return false;
  return IN_SCOPE.test(relPath);
}

function main() {
  const added = requireAddedLines(REPO_ROOT, "guard-no-unbounded-table-reads");

  const violations = [];
  for (const [absPath, lineNumbers] of added) {
    const rel = path.relative(REPO_ROOT, absPath).replace(/\\/g, "/");
    if (!inScope(rel)) continue;

    let source;
    try {
      source = readFileSync(absPath, "utf8");
    } catch (error) {
      console.error(
        `guard-no-unbounded-table-reads: could not read ${rel}: ${error.message}`,
      );
      process.exit(GUARD_EXIT_COULD_NOT_RUN);
    }

    violations.push(
      ...findUnboundedTableReadViolations(rel, source, lineNumbers),
    );
  }

  if (violations.length === 0) {
    console.log("guard-no-unbounded-table-reads: OK");
    process.exit(0);
  }

  console.error(
    `guard-no-unbounded-table-reads: ${violations.length} unbounded table read(s) added.`,
  );
  console.error(
    "\nDatabase transfer is billed per row returned, and a read with no WHERE and\n" +
      "no LIMIT returns the whole table every time it runs. On a hot path that is\n" +
      "multiplied by every request: getAllSettings() read ~133k settings rows\n" +
      "several times a second and Neon billed ~170 TB of transfer in one month.\n",
  );
  for (const violation of violations) {
    console.error(
      `  ${violation.file}:${violation.line} — ${violation.snippet}`,
    );
    console.error(`    ${violation.reason}`);
  }
  console.error(
    "\nBound the read instead:\n" +
      "  - filter by key or owner (getSetting, listSettingsByPrefix)\n" +
      "  - paginate with LIMIT / .limit()\n" +
      "  - project only the columns the caller needs\n" +
      "  - move a genuine full scan to a scheduled job (see `recurring-jobs`)\n",
  );
  console.error(
    "If the whole-table read is intentional and reviewed, put the opt-out comment\n" +
      "on the flagged line or the line immediately above it:\n" +
      "  // guard:allow-unbounded-read — short reason\n",
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
