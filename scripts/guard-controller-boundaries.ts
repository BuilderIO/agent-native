import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { scanModuleSpecifiers } from "./guard-toolkit-must-not-import-core";

export interface ControllerBoundaryViolation {
  file: string;
  line: number;
  reason: string;
}

const forbiddenPackageImports = [
  "@agent-native/toolkit/ui",
  "@agent-native/toolkit/design-system",
  "class-variance-authority",
  "tailwind-merge",
];
const tailwindToken =
  /^(?:flex|grid|block|hidden|items-|justify-|gap-|space-|p[trblxy]?-|m[trblxy]?-|w-|h-|min-|max-|text-|font-|leading-|tracking-|bg-|border|border-|rounded|rounded-|shadow|shadow-|opacity-|hover:|focus:|dark:)/;

function isForbiddenImport(specifier: string): boolean {
  return forbiddenPackageImports.some(
    (prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`),
  );
}

function containsTailwindClasses(value: string): boolean {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  return tokens.filter((token) => tailwindToken.test(token)).length >= 2;
}

export function findControllerBoundaryViolations(
  file: string,
  content: string,
): ControllerBoundaryViolation[] {
  const violations: ControllerBoundaryViolation[] = [];
  const lineAt = (index: number) => content.slice(0, index).split("\n").length;
  const add = (index: number, reason: string) =>
    violations.push({ file, line: lineAt(index), reason });

  for (const { index, value: specifier } of scanModuleSpecifiers(content)) {
    if (
      isForbiddenImport(specifier) ||
      /(?:^|\/)ui(?:\/|$)/.test(specifier) ||
      /(?:^|\/)design-system(?:\/|$)/.test(specifier)
    ) {
      add(index, `imports presentation module ${specifier}`);
    }
  }

  const masked = maskStringsAndComments(content);
  const className = /\bclassName\b/.exec(masked);
  if (className) add(className.index, "contains className presentation state");
  if (file.endsWith(".tsx")) {
    const jsx = /<(?:[A-Z][A-Za-z0-9.]*|>|\/?>)/.exec(masked);
    if (jsx) add(jsx.index, "contains JSX");
  }
  for (const literal of stringLiterals(content)) {
    if (containsTailwindClasses(literal.value)) {
      add(literal.index, "contains Tailwind utility classes");
      break;
    }
  }
  return violations;
}

function stringLiterals(
  source: string,
): Array<{ index: number; value: string }> {
  const literals: Array<{ index: number; value: string }> = [];
  let cursor = 0;
  while (cursor < source.length) {
    if (source.slice(cursor, cursor + 2) === "//") {
      cursor = source.indexOf("\n", cursor + 2);
      if (cursor === -1) break;
      continue;
    }
    if (source.slice(cursor, cursor + 2) === "/*") {
      const end = source.indexOf("*/", cursor + 2);
      cursor = end === -1 ? source.length : end + 2;
      continue;
    }
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'" && quote !== "`") {
      cursor += 1;
      continue;
    }
    const start = cursor;
    let value = "";
    cursor += 1;
    while (cursor < source.length && source[cursor] !== quote) {
      if (source[cursor] === "\\") cursor += 1;
      value += source[cursor] ?? "";
      cursor += 1;
    }
    literals.push({ index: start, value });
    cursor += 1;
  }
  return literals;
}

function maskStringsAndComments(source: string): string {
  const characters = [...source];
  for (const literal of stringLiterals(source)) {
    for (
      let index = literal.index;
      index < literal.index + literal.value.length + 2;
      index += 1
    ) {
      if (characters[index] !== "\n") characters[index] = " ";
    }
  }
  return characters
    .join("")
    .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (value) =>
      value.replace(/[^\n]/g, " "),
    );
}

function walkControllers(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkControllers(child);
    if (!entry.isFile() || !/Controller\.tsx?$/.test(entry.name)) return [];
    if (/\.(?:spec|test)\.tsx?$/.test(entry.name)) return [];
    return [child];
  });
}

function main(): void {
  const root = path.resolve(import.meta.dirname, "..");
  const violations = ["packages/core/src", "packages/toolkit/src"].flatMap(
    (directory) =>
      walkControllers(path.join(root, directory)).flatMap((file) =>
        findControllerBoundaryViolations(
          path.relative(root, file),
          readFileSync(file, "utf8"),
        ),
      ),
  );

  if (violations.length > 0) {
    console.error(
      `[guard:controller-boundaries] ${violations.length} violation(s):\n${violations
        .map(({ file, line, reason }) => `- ${file}:${line} ${reason}`)
        .join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log("[guard:controller-boundaries] clean");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
