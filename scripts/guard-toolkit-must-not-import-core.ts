import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CORE_PACKAGE_PREFIX = "@agent-native/core";
const TOOLKIT_ROOT = "packages/toolkit";
const EXCLUDED_DIRECTORY_NAMES = new Set([
  "build",
  "corpus",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "vendor",
]);

export type ToolkitCoreImportViolation = {
  file: string;
  line: number;
  specifier: string;
};

export type Specifier = {
  index: number;
  value: string;
};

function isCorePackageSpecifier(specifier: string): boolean {
  return (
    specifier === CORE_PACKAGE_PREFIX ||
    specifier.startsWith(`${CORE_PACKAGE_PREFIX}/`)
  );
}

function isIdentifierCharacter(value: string | undefined): boolean {
  return Boolean(value && /[A-Za-z0-9_$]/.test(value));
}

function isExcludedDirectoryName(name: string): boolean {
  return EXCLUDED_DIRECTORY_NAMES.has(name) || name.startsWith("corpus.tmp-");
}

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function skipSpaceAndComments(source: string, start: number): number {
  let cursor = start;
  while (cursor < source.length) {
    if (/\s/.test(source[cursor] ?? "")) {
      cursor += 1;
      continue;
    }
    if (source.slice(cursor, cursor + 2) === "//") {
      const lineEnd = source.indexOf("\n", cursor + 2);
      cursor = lineEnd === -1 ? source.length : lineEnd + 1;
      continue;
    }
    if (source.slice(cursor, cursor + 2) === "/*") {
      const blockEnd = source.indexOf("*/", cursor + 2);
      cursor = blockEnd === -1 ? source.length : blockEnd + 2;
      continue;
    }
    return cursor;
  }
  return cursor;
}

function readQuotedString(
  source: string,
  start: number,
): { end: number; value: string } | null {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") return null;
  let value = "";
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    const character = source[cursor] ?? "";
    if (character === "\\") {
      value += source[cursor + 1] ?? "";
      cursor += 1;
      continue;
    }
    if (character === quote) return { end: cursor + 1, value };
    value += character;
  }
  return null;
}

function skipStringOrComment(source: string, start: number): number {
  const character = source[start] ?? "";
  if (character === "'" || character === '"' || character === "`") {
    for (let cursor = start + 1; cursor < source.length; cursor += 1) {
      if (source[cursor] === "\\") {
        cursor += 1;
      } else if (source[cursor] === character) {
        return cursor + 1;
      }
    }
    return source.length;
  }
  if (source.slice(start, start + 2) === "//") {
    const lineEnd = source.indexOf("\n", start + 2);
    return lineEnd === -1 ? source.length : lineEnd + 1;
  }
  if (source.slice(start, start + 2) === "/*") {
    const blockEnd = source.indexOf("*/", start + 2);
    return blockEnd === -1 ? source.length : blockEnd + 2;
  }
  return start;
}

export function scanModuleSpecifiers(source: string): Specifier[] {
  const specifiers: Specifier[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const skipped = skipStringOrComment(source, cursor);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }

    const keyword = source
      .slice(cursor)
      .match(/^(?:import|export|require)\b/)?.[0];
    if (!keyword || isIdentifierCharacter(source[cursor - 1])) {
      cursor += 1;
      continue;
    }

    const statementStart = cursor;
    const argumentStart = skipSpaceAndComments(source, cursor + keyword.length);
    if (keyword === "require" || source[argumentStart] === "(") {
      const stringStart = skipSpaceAndComments(
        source,
        argumentStart + (source[argumentStart] === "(" ? 1 : 0),
      );
      const specifier = readQuotedString(source, stringStart);
      if (specifier)
        specifiers.push({ index: stringStart, value: specifier.value });
      cursor = specifier?.end ?? argumentStart + 1;
      continue;
    }

    const directSpecifier = readQuotedString(source, argumentStart);
    if (keyword === "import" && directSpecifier) {
      specifiers.push({ index: argumentStart, value: directSpecifier.value });
      cursor = directSpecifier.end;
      continue;
    }

    cursor = argumentStart;
    while (cursor < source.length && source[cursor] !== ";") {
      const nestedSkipped = skipStringOrComment(source, cursor);
      if (nestedSkipped !== cursor) {
        cursor = nestedSkipped;
        continue;
      }
      if (
        source.slice(cursor, cursor + 4) === "from" &&
        !isIdentifierCharacter(source[cursor - 1]) &&
        !isIdentifierCharacter(source[cursor + 4])
      ) {
        const stringStart = skipSpaceAndComments(source, cursor + 4);
        const specifier = readQuotedString(source, stringStart);
        if (specifier) {
          specifiers.push({ index: stringStart, value: specifier.value });
          cursor = specifier.end;
          break;
        }
      }
      cursor += 1;
      if (cursor - statementStart > 20_000) break;
    }
  }
  return specifiers;
}

export function findToolkitCoreImports(
  file: string,
  source: string,
): ToolkitCoreImportViolation[] {
  return scanModuleSpecifiers(source)
    .filter((specifier) => isCorePackageSpecifier(specifier.value))
    .map((specifier) => ({
      file,
      line: lineAt(source, specifier.index),
      specifier: specifier.value,
    }));
}

export function shouldScanToolkitFile(relativeFile: string): boolean {
  const normalized = relativeFile.split(path.sep).join("/");
  if (!normalized.startsWith(`${TOOLKIT_ROOT}/`)) return false;
  if (!/\.(?:[cm]?[jt]sx?)$/.test(normalized)) return false;
  if (/\.(?:generated|gen)\.(?:[cm]?[jt]sx?)$/.test(normalized)) return false;
  return !normalized
    .split("/")
    .some((segment) => isExcludedDirectoryName(segment));
}

function discoverFiles(repoRoot: string): string[] {
  const files: string[] = [];
  const visit = (absolutePath: string): void => {
    for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
      const child = path.join(absolutePath, entry.name);
      const relative = path.relative(repoRoot, child);
      if (entry.isDirectory()) {
        if (!isExcludedDirectoryName(entry.name)) visit(child);
      } else if (entry.isFile() && shouldScanToolkitFile(relative)) {
        files.push(relative);
      }
    }
  };
  visit(path.join(repoRoot, TOOLKIT_ROOT));
  return files;
}

function main(): void {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const violations = discoverFiles(repoRoot).flatMap((file) =>
    findToolkitCoreImports(
      file,
      readFileSync(path.join(repoRoot, file), "utf8"),
    ),
  );
  if (violations.length > 0) {
    console.error(
      `[guard:toolkit-must-not-import-core] ${violations.length} violation(s):\n${violations.map((item) => `- ${item.file}:${item.line} imports ${item.specifier}; packages/toolkit must not import @agent-native/core.`).join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log("[guard:toolkit-must-not-import-core] clean");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
