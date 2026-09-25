#!/usr/bin/env node
/**
 * guard-no-silent-coercion.mjs
 *
 * CLAUDE.md's flagship rule: a catch, default, or coercion that returns a
 * value callers cannot distinguish from success is a bug, not a guard.
 * Six weeks of repeat user reports traced back to exactly this habit — each
 * layer swallowed a failure into a plausible-looking empty/default value, so
 * every layer above it reported something confidently wrong and nobody could
 * see where the data actually went missing.
 *
 * The repo already has ~459 empty catch blocks and thousands of `?? []`
 * sites, so a whole-repo scan is unshippable noise. This guard is diff-scoped
 * via scripts/lib/changed-lines.mjs: it only fails on lines THIS branch
 * added, so the habit stops spreading without demanding a pre-existing
 * backlog get cleaned up in the same PR.
 *
 * Patterns rejected on added lines in .ts/.tsx files:
 *   - an empty catch block: catch {} / catch (e) {} / a catch body that is
 *     only a comment or a bare `return` of a falsy/empty literal
 *   - .catch(() => []) / .catch(() => null) / .catch(() => ({})) /
 *     .catch(() => false) / .catch(() => 0) / .catch(() => "")
 *   - `?? []`, `?? {}`, `?? null`, `|| []`, `|| {}`, `|| 0` applied to an
 *     `await` expression on the same line
 *
 * None of these are banned outright — sometimes an empty result truly means
 * "nothing found". The point is to make that decision visible in review, not
 * to ban the pattern. Opt out per line with:
 *
 *   // coercion-ok: <reason>
 *
 * on the same line or the line immediately above it.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { requireAddedLines } from "./lib/changed-lines.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const TEST_FILE_RE = /\.(spec|test)\.tsx?$/;
const TS_FILE_RE = /\.tsx?$/;
const SKIP_PATH_RE = /[/\\](node_modules|dist)[/\\]/;

const PRAGMA_RE = /\/\/\s*coercion-ok:/i;

const DOT_CATCH_RE =
  /\.catch\(\s*\(\)\s*=>\s*(?:\[\]|null|\(\{\}\)|false|0|""|'')\s*\)/;

// Lazily consume everything up to the operator as long as no `;` is crossed,
// so two unrelated statements on one line (`await x(); y() ?? []`) don't
// pair an await from one statement with a coercion from the next.
// \b after `\]`/`\}` would never match (both are non-word chars, and the
// token after them — `;`, `,`, `)` — is non-word too, so no boundary exists
// there); only `null`/`0` need the trailing boundary.
const AWAIT_NULLISH_RE = /\bawait\b(?:(?!;).)*?\?\?\s*(?:\[\]|\{\}|null\b)/;
const AWAIT_OR_RE = /\bawait\b(?:(?!;).)*?\|\|\s*(?:\[\]|\{\}|0\b)/;

/** Falsy/empty literal a bare `return` can hide a swallowed failure behind. */
const BARE_RETURN_RE =
  /^return\s+(?:\[\]|\{\}|null|undefined|false|0|""|''|``)\s*;?$/;

function isRelevantFile(file) {
  return (
    TS_FILE_RE.test(file) &&
    !TEST_FILE_RE.test(file) &&
    !SKIP_PATH_RE.test(file)
  );
}

/**
 * Walk up through a contiguous run of `//` comment lines rather than checking
 * only the line above. A rationale worth writing is usually longer than one
 * line, and requiring the keyword on the last of them would push authors to
 * cram the reason onto one line or reshape the expression around the guard.
 */
function hasPragma(lines, lineNo) {
  if (PRAGMA_RE.test(lines[lineNo - 1] ?? "")) return true;
  for (let index = lineNo - 2; index >= 0; index -= 1) {
    const line = (lines[index] ?? "").trim();
    if (!line.startsWith("//")) return false;
    if (PRAGMA_RE.test(line)) return true;
  }
  return false;
}

/**
 * For a catch block the pragma may sit on the header line, the line above
 * it, or as the (otherwise "empty") body's own comment — that last spot is
 * the natural place to write `// coercion-ok: <reason>` for an
 * intentionally-swallowed error, and is exactly the shape this guard
 * would otherwise flag as "body is only a comment".
 */
function hasPragmaInRange(lines, startLine, endLine) {
  for (let l = Math.max(1, startLine - 1); l <= endLine; l++) {
    if (PRAGMA_RE.test(lines[l - 1] ?? "")) return true;
  }
  return false;
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function isSilentEmptyCatchBody(body) {
  const stripped = stripComments(body).trim();
  return stripped === "" || BARE_RETURN_RE.test(stripped);
}

/**
 * Scan forward from just inside an opening `{` to find its match, skipping
 * over string/template literals and comments so a `}` inside a log message
 * (or a nested block) can't be mistaken for the catch's own close.
 */
function findMatchingBrace(src, start) {
  let depth = 1;
  let i = start;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      if (nl === -1) return -1;
      i = nl;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) return -1;
      i = end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        i += src[i] === "\\" ? 2 : 1;
      }
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/** try/catch blocks only — `.catch(cb)` calls never have a bare `{` here. */
function findCatchBlocks(src) {
  const headerRe = /\bcatch\b\s*(\([^)]*\))?\s*\{/g;
  const blocks = [];
  let m;
  while ((m = headerRe.exec(src))) {
    const bodyStart = m.index + m[0].length;
    const bodyEnd = findMatchingBrace(src, bodyStart);
    if (bodyEnd === -1) continue; // unbalanced (shouldn't happen); skip rather than guess
    blocks.push({ headerIndex: m.index, bodyStart, bodyEnd });
    headerRe.lastIndex = bodyEnd;
  }
  return blocks;
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (src[i] === "\n") line++;
  return line;
}

function checkFile(file, addedSet) {
  let src;
  try {
    src = readFileSync(file, "utf8");
  } catch (err) {
    console.error(
      `guard-no-silent-coercion: could not read ${path.relative(REPO_ROOT, file)}, skipping: ${err.message}`,
    );
    return [];
  }
  const lines = src.split("\n");
  const violations = [];

  for (const { headerIndex, bodyStart, bodyEnd } of findCatchBlocks(src)) {
    const body = src.slice(bodyStart, bodyEnd);
    if (!isSilentEmptyCatchBody(body)) continue;
    const headerLine = lineOf(src, headerIndex);
    const bodyEndLine = lineOf(src, bodyEnd);
    let reportLine = null;
    for (let l = headerLine; l <= bodyEndLine; l++) {
      if (addedSet.has(l)) {
        reportLine = addedSet.has(headerLine) ? headerLine : l;
        break;
      }
    }
    if (reportLine === null) continue; // block predates this branch
    if (hasPragmaInRange(lines, headerLine, bodyEndLine)) continue;
    violations.push({
      file,
      line: reportLine,
      text: (lines[reportLine - 1] ?? "").trim(),
      reason: "empty catch block swallows the error",
    });
  }

  for (const lineNo of addedSet) {
    const text = lines[lineNo - 1];
    if (text === undefined) continue;
    if (hasPragma(lines, lineNo)) continue;
    if (DOT_CATCH_RE.test(text)) {
      violations.push({
        file,
        line: lineNo,
        text: text.trim(),
        reason: ".catch() discards the rejection into a default value",
      });
    } else if (AWAIT_NULLISH_RE.test(text) || AWAIT_OR_RE.test(text)) {
      violations.push({
        file,
        line: lineNo,
        text: text.trim(),
        reason:
          "coercion hides a possible await failure/undefined behind an empty default",
      });
    }
  }

  return violations;
}

function main() {
  const added = requireAddedLines(REPO_ROOT, "guard-no-silent-coercion");

  const violations = [];
  for (const [file, addedSet] of added) {
    if (!isRelevantFile(file)) continue;
    violations.push(...checkFile(file, addedSet));
  }

  if (violations.length === 0) {
    console.log("guard-no-silent-coercion: OK");
    process.exit(0);
    return;
  }

  console.error(
    `\nguard-no-silent-coercion: ${violations.length} violation(s) found on lines this branch added.\n`,
  );
  console.error(
    "A catch, default, or coercion that returns a value callers cannot\n" +
      "distinguish from success is a bug, not a guard. Throw, log-and-rethrow,\n" +
      "or return a typed 'absent' value the caller can tell apart from an\n" +
      "empty/successful one.\n",
  );
  for (const v of violations) {
    console.error(
      `  ${path.relative(REPO_ROOT, v.file)}:${v.line}  ${v.text}\n    (${v.reason})`,
    );
  }
  console.error(
    "\nTo opt out for a specific line add the comment:\n" +
      "  // coercion-ok: <reason>\n" +
      "on the same line or the line immediately above it.\n",
  );
  process.exit(1);
}

main();
