/**
 * guard-no-bare-error-in-actions.ts
 *
 * The action boundary (packages/core/src/server/action-routes.ts) only treats
 * `fail()` / ActionContractError / a status < 500 as a user-facing failure. A
 * bare `throw new Error("<sentence>")` is indistinguishable from a driver or
 * upstream blowup, so it becomes a 500 AND a captured error. Expected user
 * states thrown that way flooded error capture: an outdated plan revision
 * (928 events, 36 users), a deleted generation run polled forever (2,314
 * events, one user), "Only Dispatch admins can inspect thread databases"
 * (3,209), a Slides home page calling an LLM action for users with no provider
 * on every visit.
 *
 * Throw expected failures with `fail(message, { errorCode, statusCode })` from
 * `@agent-native/core/action` (409 conflict, 404 not found, 403 admin-only,
 * 412/424 missing connection or provider, 400/422 validation). That is typed,
 * non-5xx, and never captured as an exception.
 *
 * This guard only scans lines ADDED on this branch (via
 * scripts/lib/changed-lines.mjs) in action files and flags a `throw` of
 * `new Error(...)` / `Error(...)` whose message carries a literal sentence (two
 * or more literal words, in a string, template or `+` concatenation). A
 * message built purely from variables or a single word is not flagged.
 *
 * A genuine invariant violation (a state that means a bug, not a user
 * situation) keeps a bare Error. Say so on the throw, on any line of it, or
 * on the line immediately above it:
 *
 *   // guard:allow-bare-error — invariant: <why this can never be user state>
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

const GUARD_NAME = "guard:no-bare-error-in-actions";
const rootDir = path.resolve(import.meta.dirname, "..");

const PRAGMA = /(?:\/\/|\/\*)\s*guard:allow-bare-error\b/;
const IN_SCOPE =
  /^(?:templates\/[^/]+\/actions\/|apps\/[^/]+\/actions\/|packages\/[^/]+\/src\/(?:.+\/)?actions\/)/;
const SKIPPED = /(\.spec\.|\.test\.|\/__tests__\/|\/dist\/|\/node_modules\/)/;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

export interface BareErrorFinding {
  file: string;
  line: number;
  snippet: string;
}

export function isActionSourcePath(relPath: string): boolean {
  return (
    !SKIPPED.test(relPath) &&
    SOURCE_FILE.test(relPath) &&
    IN_SCOPE.test(relPath)
  );
}

function literalText(node: ts.Expression): string | null {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
    return literalText(node.expression);
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)]
      .join(" ")
      .trim();
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    return [literalText(node.left), literalText(node.right)]
      .filter((part): part is string => part !== null)
      .join(" ");
  }
  return null;
}

function carriesSentence(message: ts.Expression): boolean {
  const words = literalText(message)?.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
  return words.length >= 2;
}

function isBareErrorWithSentence(expression: ts.Expression): boolean {
  if (!ts.isNewExpression(expression) && !ts.isCallExpression(expression)) {
    return false;
  }
  const callee = expression.expression;
  if (!ts.isIdentifier(callee) || callee.text !== "Error") return false;
  const message = expression.arguments?.[0];
  return message !== undefined && carriesSentence(message);
}

export function findBareErrorThrows(
  file: string,
  source: string,
  addedLines: ReadonlySet<number>,
): BareErrorFinding[] {
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
  const findings: BareErrorFinding[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isThrowStatement(node) &&
      node.expression &&
      isBareErrorWithSentence(node.expression)
    ) {
      const start =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1;
      const end = sourceFile.getLineAndCharacterOfPosition(node.end).line + 1;
      const touched = [...addedLines].some(
        (line) => line >= start && line <= end,
      );
      const opted =
        lines.slice(start - 1, end).some((line) => PRAGMA.test(line)) ||
        PRAGMA.test(lines[start - 2] ?? "");
      if (touched && !opted) {
        findings.push({
          file,
          line: start,
          snippet: node.getText(sourceFile).replace(/\s+/g, " ").slice(0, 120),
        });
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
  const findings: BareErrorFinding[] = [];
  for (const [absPath, lineNumbers] of added) {
    const rel = path.relative(rootDir, absPath).replace(/\\/g, "/");
    if (!isActionSourcePath(rel)) continue;

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
    findings.push(...findBareErrorThrows(rel, source, lineNumbers));
  }

  if (findings.length === 0) {
    console.log(
      `${GUARD_NAME}: OK (${inspected} changed action file(s) inspected)`,
    );
    return;
  }

  console.error(
    `${GUARD_NAME}: ${findings.length} bare Error throw(s) added in actions.`,
  );
  console.error(
    '\nA bare `throw new Error("...")` in an action is a 500 and a captured\n' +
      "exception. If this is an expected user state (conflict, not found, not\n" +
      "permitted, missing connection or provider, invalid input), throw it typed:\n\n" +
      '  import { fail } from "@agent-native/core/action";\n' +
      '  fail("<same message>", { errorCode: "plan_revision_conflict", statusCode: 409 });\n\n' +
      "  409 conflict · 404 not found · 403 admin-only · 412/424 missing\n" +
      "  connection or provider · 400/422 validation\n",
  );
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line} — ${finding.snippet}`);
  }
  console.error(
    "\nIf this is an invariant violation (a bug, never a user situation), keep\n" +
      "the Error and say why on the throw, any line of it, or the line above:\n" +
      "  // guard:allow-bare-error — invariant: <why>\n",
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
