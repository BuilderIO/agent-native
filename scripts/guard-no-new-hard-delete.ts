/**
 * guard-no-new-hard-delete.ts
 *
 * Deleting something a person made must be undoable: the delete stamps
 * `deletedAt`, reads hide stamped rows, and a restore action clears the stamp
 * (see the `soft-delete` skill). A new hard delete removes the row and
 * everything hanging off it with no way back, and an agent can do that in one
 * ambiguous tool call.
 *
 * This guard only scans lines ADDED on this branch (via
 * scripts/lib/changed-lines.mjs) in app actions/server code and flags a Drizzle delete on a database handle (`db.delete(table)`,
 * `tx.delete(table)`, `getDb().delete(table)`) or a `DELETE FROM` in a SQL
 * string or template. Core source is out of scope: its deletes are almost
 * all runtime bookkeeping (run events, leases, application state), so a
 * required pragma there would be pasted by reflex and stop meaning anything.
 *
 * Purges, revocations, credentials, and ephemeral rows are legitimately hard
 * deletes. Say so on the statement, on any line of it, or on the line
 * immediately above it:
 *
 *   // guard:allow-hard-delete — <why this row must really go>
 *
 * Same diff-base contract as every guard built on changed-lines.mjs: if the
 * base cannot be resolved the guard exits GUARD_EXIT_COULD_NOT_RUN, which
 * run-guards.ts reports as SKIPPED, because a silent pass would look
 * identical to a real clean run.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import {
  GUARD_EXIT_COULD_NOT_RUN,
  requireAddedLines,
} from "./lib/changed-lines.mjs";

const GUARD_NAME = "guard:no-new-hard-delete";
const rootDir = path.resolve(import.meta.dirname, "..");

const PRAGMA = /(?:\/\/|\/\*)\s*guard:allow-hard-delete\b/;
const IN_SCOPE =
  /^(?:templates|community-templates|apps)\/[^/]+\/(?:actions|server)\//;
const SKIPPED =
  /(\.spec\.|\.test\.|\/__tests__\/|\/e2e\/|\/dist\/|\/node_modules\/)/;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const DB_HANDLE = /^(?:db|tx|trx|database|transaction|\w+Db|\w+Tx)$/;
const DB_GETTER = /^get\w*(?:Db|Database)$/;

export interface HardDeleteFinding {
  file: string;
  line: number;
  snippet: string;
}

export function isHardDeleteScopePath(relPath: string): boolean {
  return (
    !SKIPPED.test(relPath) &&
    SOURCE_FILE.test(relPath) &&
    IN_SCOPE.test(relPath)
  );
}

function isDbHandle(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) return DB_HANDLE.test(node.text);
  if (ts.isPropertyAccessExpression(node)) {
    return DB_HANDLE.test(node.name.text);
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    return DB_GETTER.test(node.expression.text);
  }
  return false;
}

function isDrizzleDelete(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "delete" &&
    node.arguments.length === 1 &&
    isDbHandle(node.expression.expression)
  );
}

function literalSql(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)]
      .join(" ")
      .trim();
  }
  return null;
}

function isDeleteSql(text: string): boolean {
  return /\bDELETE\s+FROM\b/.test(text) || /^\s*delete\s+from\b/i.test(text);
}

function enclosingStatement(node: ts.Node): ts.Node {
  let current = node;
  while (
    current.parent &&
    !ts.isSourceFile(current.parent) &&
    !ts.isBlock(current.parent) &&
    !ts.isModuleBlock(current.parent) &&
    !ts.isCaseClause(current.parent) &&
    !ts.isDefaultClause(current.parent)
  ) {
    current = current.parent;
  }
  return current;
}

export function findHardDeletes(
  file: string,
  source: string,
  addedLines: ReadonlySet<number>,
): HardDeleteFinding[] {
  const kind = /\.[cm]?tsx$|\.[cm]?jsx$/.test(file)
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const lines = source.split(/\r?\n/);
  const lineOf = (pos: number) =>
    sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
  const findings: HardDeleteFinding[] = [];

  const report = (node: ts.Node, firstLine: number, lastLine: number) => {
    const touched = [...addedLines].some(
      (line) => line >= firstLine && line <= lastLine,
    );
    if (!touched) return;
    const statement = enclosingStatement(node);
    const start = lineOf(statement.getStart(sourceFile));
    const end = lineOf(statement.end);
    const opted =
      lines.slice(start - 1, end).some((line) => PRAGMA.test(line)) ||
      PRAGMA.test(lines[start - 2] ?? "");
    if (opted) return;
    findings.push({
      file,
      line: firstLine,
      snippet: node.getText(sourceFile).replace(/\s+/g, " ").slice(0, 120),
    });
  };

  const visit = (node: ts.Node) => {
    if (isDrizzleDelete(node)) {
      const name = (node.expression as ts.PropertyAccessExpression).name;
      const line = lineOf(name.getStart(sourceFile));
      report(node, line, line);
    } else {
      const text = literalSql(node);
      if (text !== null && isDeleteSql(text)) {
        report(node, lineOf(node.getStart(sourceFile)), lineOf(node.end));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

function main() {
  const added = requireAddedLines(rootDir, GUARD_NAME);

  let inspected = 0;
  const findings: HardDeleteFinding[] = [];
  for (const [absPath, lineNumbers] of added) {
    const rel = path.relative(rootDir, absPath).replace(/\\/g, "/");
    if (!isHardDeleteScopePath(rel)) continue;

    let source: string;
    try {
      source = readFileSync(absPath, "utf8");
    } catch (error) {
      console.error(
        `${GUARD_NAME}: could not read ${rel}: ${(error as Error).message}`,
      );
      process.exit(GUARD_EXIT_COULD_NOT_RUN);
    }
    inspected += 1;
    findings.push(...findHardDeletes(rel, source, lineNumbers));
  }

  if (findings.length === 0) {
    console.log(`${GUARD_NAME}: OK (${inspected} changed file(s) inspected)`);
    return;
  }

  console.error(`${GUARD_NAME}: ${findings.length} hard delete(s) added.`);
  console.error(
    "\nDeleting something a person made must be undoable. Stamp the row\n" +
      "instead, hide stamped rows from reads, and add a restore action\n" +
      "(see the soft-delete skill):\n\n" +
      "  await db.update(schema.decks).set({ deletedAt: now }).where(eq(schema.decks.id, id));\n",
  );
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line} — ${finding.snippet}`);
  }
  console.error(
    "\nIf the row must really go (a purge of an already-deleted row, a\n" +
      "revocation, a credential, or ephemeral data), say why on the\n" +
      "statement, any line of it, or the line above:\n" +
      "  // guard:allow-hard-delete — <why>\n",
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
