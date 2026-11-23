import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { reservedClassNames } from "../packages/design-system/src/catalog/parts.ts";
import {
  GUARD_EXIT_COULD_NOT_RUN,
  requireAddedLines,
} from "./lib/changed-lines.mjs";

const GUARD_NAME = "guard:no-part-class-redefinition";
const rootDir = path.resolve(import.meta.dirname, "..");

const IN_SCOPE = /^(?:templates|packages)\/.+\.s?css$/;
const OWNED_BY_DESIGN_SYSTEM =
  /^packages\/design-system\/css\/|^packages\/toolkit\/\.storybook\//;
const SKIPPED_PATH =
  /(?:^|\/)(?:node_modules|dist|build|coverage|\.output|\.generated)\//;
const PRAGMA = /guard:allow-part-class\s+(.*?)\s*(?:\*\/)?$/;
const MIN_REASON_LENGTH = 10;

export interface PartClassFinding {
  file: string;
  line: number;
  className: string;
  selector: string;
}

export function isInScope(relPath: string): boolean {
  return (
    IN_SCOPE.test(relPath) &&
    !OWNED_BY_DESIGN_SYSTEM.test(relPath) &&
    !SKIPPED_PATH.test(relPath)
  );
}

interface Prelude {
  text: string;
  startLine: number;
  endLine: number;
}

function selectorPreludes(source: string): Prelude[] {
  const preludes: Prelude[] = [];
  let line = 1;
  let start = 0;
  let startLine = 1;
  let quote: string | null = null;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === "\n") line++;
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (let skip = index; skip < stop; skip++) {
        if (source[skip] === "\n") line++;
      }
      if (source.slice(start, index).trim() === "") {
        start = stop;
        startLine = line;
      }
      index = stop - 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "}" || char === ";") {
      if (char === "{") {
        const text = source.slice(start, index);
        const leading = text.length - text.trimStart().length;
        const firstLine =
          startLine + (text.slice(0, leading).match(/\n/g)?.length ?? 0);
        preludes.push({
          text: text.trim(),
          startLine: firstLine,
          endLine: line,
        });
      }
      start = index + 1;
      startLine = line;
    }
  }
  return preludes.filter(
    (prelude) => prelude.text !== "" && !prelude.text.startsWith("@"),
  );
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ");
}

function hasPragma(lines: string[], lineNumber: number): boolean {
  for (const candidate of [lineNumber, lineNumber - 1]) {
    const match = PRAGMA.exec(lines[candidate - 1] ?? "");
    if (match && match[1].length >= MIN_REASON_LENGTH) return true;
  }
  return false;
}

export function findPartClassRedefinitions(
  file: string,
  source: string,
  addedLines: ReadonlySet<number> | null,
  reserved: ReadonlySet<string>,
): PartClassFinding[] {
  const lines = source.split("\n");
  const findings: PartClassFinding[] = [];
  for (const prelude of selectorPreludes(source)) {
    const touched =
      addedLines === null ||
      Array.from(
        { length: prelude.endLine - prelude.startLine + 1 },
        (_, offset) => prelude.startLine + offset,
      ).some((lineNumber) => addedLines.has(lineNumber));
    if (!touched) continue;
    const selector = stripComments(prelude.text).replace(/\s+/g, " ");
    const unquoted = selector.replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""');
    for (const match of unquoted.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
      const className = match[1];
      if (!reserved.has(className)) continue;
      if (hasPragma(lines, prelude.startLine)) continue;
      findings.push({
        file,
        line: prelude.startLine,
        className,
        selector,
      });
    }
  }
  return findings;
}

function main(): void {
  const reserved = new Set(reservedClassNames());
  if (reserved.size === 0) {
    console.error(`${GUARD_NAME}: the part catalog reserved no class names.`);
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
  }
  const added = requireAddedLines(rootDir, GUARD_NAME);
  let inspected = 0;
  const findings: PartClassFinding[] = [];
  for (const [absPath, lineNumbers] of added) {
    const rel = path.relative(rootDir, absPath).replace(/\\/g, "/");
    if (!isInScope(rel)) continue;
    inspected++;
    findings.push(
      ...findPartClassRedefinitions(
        rel,
        readFileSync(absPath, "utf8"),
        lineNumbers,
        reserved,
      ),
    );
  }
  if (findings.length === 0) {
    console.log(
      `${GUARD_NAME}: OK (${inspected} changed stylesheet(s) inspected)`,
    );
    return;
  }
  console.error(
    `${GUARD_NAME}: ${findings.length} selector(s) restyle a design-system part class.\n` +
      "Part classes are shared by every app and theme; restyle a part through a\n" +
      "theme or its --<part>-* inputs, and put layout on a wrapper or utilities.\n",
  );
  for (const finding of findings) {
    console.error(
      `  ${finding.file}:${finding.line}  .${finding.className}  in "${finding.selector}"`,
    );
  }
  console.error(
    "\nIf this really must target the part, add on the selector line or the line above:\n" +
      "  /* guard:allow-part-class <reason of 10+ characters> */\n",
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
